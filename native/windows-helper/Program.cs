using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Twirly.Helper;

/// <summary>
/// Twirly's input-state helper. It installs low-level mouse and keyboard hooks (which run in
/// this process, no injection) and reports one thing to the Electron parent over stdout:
/// "the trigger key (default Shift) was pressed while the left button was held and the cursor had moved past the system
/// drag threshold". It never sees, reads or touches the drag payload; Electron receives that
/// through standard OLE drag-and-drop once its window is under the cursor.
///
/// Protocol: one JSON object per line on stdout. Config lines may arrive on stdin.
/// The helper exits when stdin closes or the parent process exits.
/// </summary>
public static unsafe class Program
{
    private const int ProtocolVersion = 1;

    private static readonly BlockingCollection<string> Outbox = new(256);
    private static nint _mouseHook;
    private static nint _keyboardHook;
    private static uint _hookThreadId;

    // Gesture state; touched only on the hook thread.
    private static bool _buttonDown;
    private static bool _moved;
    private static bool _summoned;
    private static bool _triggerHeldAtButtonDown;
    private static bool _triggerDown;
    private static Native.POINT _downPoint;
    private static int _dragX = 4, _dragY = 4;

    // Config; written from the stdin thread.
    // References are swapped atomically; the collections themselves are never mutated.
    private static volatile string _scope = "explorer"; // "explorer" | "anywhere" | "custom"
    private static volatile bool _enabled = true;
    private static volatile HashSet<string> _apps = new(StringComparer.OrdinalIgnoreCase) { "explorer.exe" };
    private static volatile HashSet<int> _triggerVks = [Native.VK_SHIFT, Native.VK_LSHIFT, Native.VK_RSHIFT];

    public static int Main(string[] args)
    {
        if (args.Contains("--selftest")) return SelfTest();

        var parentPid = ParseParentPid(args);
        StartWriter();
        StartStdinReader();
        if (parentPid is int pid) WatchParent(pid);

        _dragX = Math.Max(1, Native.GetSystemMetrics(Native.SM_CXDRAG));
        _dragY = Math.Max(1, Native.GetSystemMetrics(Native.SM_CYDRAG));
        _hookThreadId = Native.GetCurrentThreadId();

        _mouseHook = Native.SetWindowsHookExW(Native.WH_MOUSE_LL, &MouseProc, 0, 0);
        _keyboardHook = Native.SetWindowsHookExW(Native.WH_KEYBOARD_LL, &KeyboardProc, 0, 0);
        if (_mouseHook == 0 || _keyboardHook == 0)
        {
            Send("error", w => w.WriteString("message", $"SetWindowsHookEx failed ({Marshal.GetLastPInvokeError()})"));
            Thread.Sleep(200);
            return 2;
        }

        Send("ready", w => w.WriteNumber("version", ProtocolVersion));

        // Low-level hooks are delivered through this thread's message loop.
        // Watchdog: Windows silently removes low-level hooks whose callback is ever too slow.
        // Every few seconds, if the cursor moved but the mouse hook saw nothing, reinstall both.
        using var watchdog = new Timer(_ => Native.PostThreadMessageW(_hookThreadId, WM_CHECK_HOOKS, 0, 0), null, 4000, 4000);
        while (Native.GetMessageW(out var msg, 0, 0, 0) > 0)
        {
            if (msg.message == WM_CHECK_HOOKS) CheckHooks();
        }

        Native.UnhookWindowsHookEx(_mouseHook);
        Native.UnhookWindowsHookEx(_keyboardHook);
        Outbox.CompleteAdding();
        return 0;
    }

    private const uint WM_CHECK_HOOKS = 0x8000 + 1; // WM_APP + 1
    private static long _mouseEvents;
    private static long _mouseEventsAtLastCheck;
    private static Native.POINT _cursorAtLastCheck;

    private static void CheckHooks()
    {
        Native.GetCursorPos(out var pos);
        var moved = pos.X != _cursorAtLastCheck.X || pos.Y != _cursorAtLastCheck.Y;
        if (moved && _mouseEvents == _mouseEventsAtLastCheck)
        {
            Native.UnhookWindowsHookEx(_mouseHook);
            Native.UnhookWindowsHookEx(_keyboardHook);
            _mouseHook = Native.SetWindowsHookExW(Native.WH_MOUSE_LL, &MouseProc, 0, 0);
            _keyboardHook = Native.SetWindowsHookExW(Native.WH_KEYBOARD_LL, &KeyboardProc, 0, 0);
            _buttonDown = false;
            _triggerDown = false;
            Send("error", w => w.WriteString("message", "input hooks were removed by Windows; reinstalled"));
        }
        _cursorAtLastCheck = pos;
        _mouseEventsAtLastCheck = _mouseEvents;
    }

    [UnmanagedCallersOnly]
    private static nint MouseProc(int nCode, nuint wParam, nint lParam)
    {
        if (nCode >= 0)
        {
            _mouseEvents++;
            var info = (Native.MSLLHOOKSTRUCT*)lParam;
            switch ((int)wParam)
            {
                case Native.WM_LBUTTONDOWN:
                    _buttonDown = true;
                    _moved = false;
                    _summoned = false;
                    _downPoint = info->pt;
                    _triggerHeldAtButtonDown = _triggerDown;
                    break;
                case Native.WM_MOUSEMOVE:
                    if (_buttonDown && !_moved &&
                        (Math.Abs(info->pt.X - _downPoint.X) > _dragX || Math.Abs(info->pt.Y - _downPoint.Y) > _dragY))
                        _moved = true;
                    break;
                case Native.WM_RBUTTONDOWN:
                    // Right-click while the drag-summoned wheel is open = cancel it.
                    if (_summoned) Send("rightdown");
                    break;
                case Native.WM_LBUTTONUP:
                    if (_buttonDown) Send("mouseup");
                    _buttonDown = false;
                    _moved = false;
                    _summoned = false;
                    break;
            }
        }
        return Native.CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    [UnmanagedCallersOnly]
    private static nint KeyboardProc(int nCode, nuint wParam, nint lParam)
    {
        if (nCode >= 0)
        {
            var info = (Native.KBDLLHOOKSTRUCT*)lParam;
            var vk = (int)info->vkCode;
            if (_triggerVks.Contains(vk))
            {
                var msg = (int)wParam;
                var down = msg is Native.WM_KEYDOWN or Native.WM_SYSKEYDOWN;
                // Key auto-repeat sends repeated KEYDOWNs; only the first transition counts.
                if (down && !_triggerDown) OnTriggerPressed();
                _triggerDown = down;
            }
        }
        return Native.CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    private static void OnTriggerPressed()
    {
        if (!_enabled || !_buttonDown || !_moved || _summoned || _triggerHeldAtButtonDown) return;
        // Must stay cheap: Windows silently removes LL hooks that exceed LowLevelHooksTimeout.
        var process = Native.ForegroundProcessName();
        if (!InScope(process)) return;
        _summoned = true;
        var pt = _downPoint;
        Send("summon", w =>
        {
            w.WriteNumber("x", pt.X);
            w.WriteNumber("y", pt.Y);
            if (process is not null) w.WriteString("process", process);
        });
    }

    private static bool InScope(string? process) => _scope switch
    {
        "anywhere" => true,
        "custom" => process is not null && _apps.Contains(process),
        _ => string.Equals(process, "explorer.exe", StringComparison.OrdinalIgnoreCase),
    };

    // ---- I/O ---------------------------------------------------------------------------------

    private static void Send(string type, Action<Utf8JsonWriter>? fields = null)
    {
        var buffer = new System.Buffers.ArrayBufferWriter<byte>(128);
        using (var w = new Utf8JsonWriter(buffer))
        {
            w.WriteStartObject();
            w.WriteString("type", type);
            fields?.Invoke(w);
            w.WriteEndObject();
        }
        // Never block the hook thread; drop messages if the parent stops reading.
        Outbox.TryAdd(System.Text.Encoding.UTF8.GetString(buffer.WrittenSpan));
    }

    private static void StartWriter()
    {
        var stdout = Console.OpenStandardOutput();
        var writer = new StreamWriter(stdout) { AutoFlush = true };
        new Thread(() =>
        {
            try { foreach (var line in Outbox.GetConsumingEnumerable()) writer.WriteLine(line); }
            catch (IOException) { Quit(); }
        }) { IsBackground = true, Name = "stdout" }.Start();
    }

    private static void StartStdinReader()
    {
        new Thread(() =>
        {
            string? line;
            while ((line = Console.In.ReadLine()) is not null)
            {
                try
                {
                    using var doc = JsonDocument.Parse(line);
                    var root = doc.RootElement;
                    if (root.TryGetProperty("type", out var t) && t.GetString() == "config")
                    {
                        if (root.TryGetProperty("scope", out var s) && s.GetString() is "explorer" or "anywhere" or "custom") _scope = s.GetString()!;
                        if (root.TryGetProperty("enabled", out var e)) _enabled = e.GetBoolean();
                        if (root.TryGetProperty("apps", out var a) && a.ValueKind == JsonValueKind.Array)
                            _apps = new HashSet<string>(a.EnumerateArray().Select(x => x.GetString() ?? "").Where(x => x.Length > 0), StringComparer.OrdinalIgnoreCase);
                        if (root.TryGetProperty("triggerVks", out var t2) && t2.ValueKind == JsonValueKind.Array)
                        {
                            var vks = new HashSet<int>(t2.EnumerateArray().Select(x => x.GetInt32()).Where(v => v is > 0 and < 256));
                            if (vks.Count > 0) _triggerVks = vks;
                        }
                    }
                }
                catch (JsonException) { /* ignore malformed config */ }
            }
            Quit(); // parent closed our stdin: it is gone
        }) { IsBackground = true, Name = "stdin" }.Start();
    }

    private static void WatchParent(int pid)
    {
        try
        {
            var parent = Process.GetProcessById(pid);
            parent.EnableRaisingEvents = true;
            parent.Exited += (_, _) => Quit();
        }
        catch (ArgumentException) { Quit(); }
    }

    private static void Quit()
    {
        if (_hookThreadId != 0) Native.PostThreadMessageW(_hookThreadId, Native.WM_QUIT, 0, 0);
        else Environment.Exit(0);
    }

    private static int? ParseParentPid(string[] args)
    {
        var i = Array.IndexOf(args, "--parent-pid");
        return i >= 0 && i + 1 < args.Length && int.TryParse(args[i + 1], out var pid) ? pid : null;
    }

    private static int SelfTest()
    {
        var report = new SelfTestReport(
            ProtocolVersion,
            Native.GetSystemMetrics(Native.SM_CXDRAG),
            Native.GetSystemMetrics(Native.SM_CYDRAG),
            Native.ForegroundProcessName(),
            Environment.Is64BitProcess);
        Console.WriteLine(JsonSerializer.Serialize(report, HelperJson.Default.SelfTestReport));
        return 0;
    }
}

public sealed record SelfTestReport(int Version, int DragX, int DragY, string? Foreground, bool Is64Bit);

// Source-generated JSON so the helper can be trimmed.
[JsonSerializable(typeof(SelfTestReport))]
internal partial class HelperJson : JsonSerializerContext;
