using System.Runtime.InteropServices;
using System.Windows.Automation;

// Drives a REAL Explorer drag with synthetic input (SendInput), the same input path a user's
// mouse takes. Used to validate docs/native-integration.md hypotheses. It moves the cursor and
// presses Shift for about 3 seconds; it always releases both in `finally`.
//
// Usage: ExplorerDragSpike --folder <dir> --item <name prefix> [--dx 0] [--dy -110] [--no-shift]
//        [--hold-ms 300] [--close-explorer] [--app explorer|files] [--move-to X,Y]

static class Program
{
    static int Main(string[] args)
    {
        string Arg(string name, string? fallback = null)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback ?? throw new ArgumentException($"missing {name}");
        }
        var folder = System.IO.Path.GetFileName(System.IO.Path.TrimEndingDirectorySeparator(Arg("--folder")));
        var item = Arg("--item");
        var dx = int.Parse(Arg("--dx", "0"));
        var dy = int.Parse(Arg("--dy", "-110"));
        var holdMs = int.Parse(Arg("--hold-ms", "300"));
        var shift = !args.Contains("--no-shift");
        // Virtual-key code of the trigger to press mid-drag (default: left Shift).
        var triggerVk = (ushort)Convert.ToInt32(Arg("--trigger-vk", "160"));

        var app = Arg("--app", "explorer");
        var window = app == "files" ? FindProcessWindow("Files", folder, TimeSpan.FromSeconds(15)) : FindExplorerWindow(folder, TimeSpan.FromSeconds(8));
        if (window is null) { Console.WriteLine($"{{\"error\":\"{app} window for '{folder}' not found\"}}"); return 2; }

        // Optionally place the window somewhere specific (e.g. on the second monitor).
        var moveTo = Arg("--move-to", "");
        if (moveTo.Length > 0)
        {
            var xy = moveTo.Split(',').Select(int.Parse).ToArray();
            Input.SetWindowPos(new IntPtr(window.Current.NativeWindowHandle), IntPtr.Zero, xy[0], xy[1], 800, 600, 0x0044 /* SHOWWINDOW|NOZORDER */);
            Thread.Sleep(800);
        }
        var target = FindItem(window, item, TimeSpan.FromSeconds(5));
        if (target is null) { Console.WriteLine($"{{\"error\":\"item '{item}' not found\"}}"); return 3; }

        var r = target.Current.BoundingRectangle;
        // Grab the item near its left (icon/name) part, which is draggable in every Explorer view.
        var startX = (int)(r.Left + Math.Min(40, r.Width / 2));
        var startY = (int)(r.Top + r.Height / 2);
        Input.GetCursorPos(out var saved);
        Console.WriteLine($"{{\"item\":\"{target.Current.Name}\",\"x\":{startX},\"y\":{startY}}}");

        // Bring Explorer to the foreground: the helper only summons over explorer.exe.
        try { ((WindowPattern)window.GetCurrentPattern(WindowPattern.Pattern)).SetWindowVisualState(WindowVisualState.Normal); } catch { }
        Input.SetForegroundWindow(new IntPtr(window.Current.NativeWindowHandle));
        Thread.Sleep(300);

        try
        {
            Input.MoveTo(startX, startY); Thread.Sleep(150);
            Input.LeftDown(); Thread.Sleep(100);
            for (var i = 1; i <= 10; i++) { Input.MoveTo(startX + i * 4, startY + i); Thread.Sleep(20); }
            Thread.Sleep(250); // Explorer enters DoDragDrop
            var x = startX + 40; var y = startY + 10;
            if (shift) { Input.Key(triggerVk, down: true); }
            Thread.Sleep(holdMs); // helper → main → wheel window shown under the cursor
            for (var i = 1; i <= 4; i++) { Input.MoveTo(x + i, y); Thread.Sleep(30); } // first OLE DragEnter on the wheel
            Thread.Sleep(150);
            for (var i = 1; i <= 12; i++) { Input.MoveTo(x + 4 + dx * i / 12, y + dy * i / 12); Thread.Sleep(25); }
            Thread.Sleep(350); // hover highlight
            Input.LeftUp();
            Thread.Sleep(150);
        }
        finally
        {
            Input.LeftUp();
            Input.Key(triggerVk, down: false);
            Input.MoveTo(saved.X, saved.Y);
        }

        if (args.Contains("--close-explorer"))
        {
            Thread.Sleep(1500);
            try { ((WindowPattern)window.GetCurrentPattern(WindowPattern.Pattern)).Close(); } catch { }
        }
        Console.WriteLine("{\"done\":true}");
        return 0;
    }

    static AutomationElement? FindExplorerWindow(string title, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        var cond = new AndCondition(
            new PropertyCondition(AutomationElement.ClassNameProperty, "CabinetWClass"),
            new PropertyCondition(AutomationElement.NameProperty, title));
        while (DateTime.UtcNow < deadline)
        {
            var w = AutomationElement.RootElement.FindFirst(TreeScope.Children, cond);
            if (w is not null) return w;
            Thread.Sleep(200);
        }
        return null;
    }

    /** Top-level window of a process (e.g. "Files") whose title starts with the folder name. */
    static AutomationElement? FindProcessWindow(string processName, string title, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var ids = System.Diagnostics.Process.GetProcessesByName(processName).Select(p => p.Id).ToHashSet();
            foreach (AutomationElement w in AutomationElement.RootElement.FindAll(TreeScope.Children, Condition.TrueCondition))
                if (ids.Contains(w.Current.ProcessId) && w.Current.Name.StartsWith(title, StringComparison.OrdinalIgnoreCase)) return w;
            Thread.Sleep(300);
        }
        return null;
    }

    static AutomationElement? FindItem(AutomationElement window, string prefix, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        var cond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem);
        while (DateTime.UtcNow < deadline)
        {
            foreach (AutomationElement el in window.FindAll(TreeScope.Descendants, cond))
                if (el.Current.Name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) return el;
            Thread.Sleep(200);
        }
        return null;
    }
}

static class Input
{
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public nint extra; }
    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public nint extra; }
    [StructLayout(LayoutKind.Explicit)]
    struct INPUT { [FieldOffset(0)] public uint type; [FieldOffset(8)] public MOUSEINPUT mi; [FieldOffset(8)] public KEYBDINPUT ki; }

    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);

    const uint MOVE = 0x0001, LDOWN = 0x0002, LUP = 0x0004, ABSOLUTE = 0x8000, VIRTUALDESK = 0x4000, KEYUP = 0x0002;

    static void Mouse(uint flags, int x = 0, int y = 0)
    {
        var input = new INPUT { type = 0, mi = new MOUSEINPUT { dx = x, dy = y, dwFlags = flags } };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }

    /// <summary>Absolute move in physical virtual-desktop pixels (works across monitors).</summary>
    public static void MoveTo(int x, int y)
    {
        int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
        var nx = (int)Math.Round((x - vx) * 65535.0 / (vw - 1));
        var ny = (int)Math.Round((y - vy) * 65535.0 / (vh - 1));
        Mouse(MOVE | ABSOLUTE | VIRTUALDESK, nx, ny);
    }

    public static void LeftDown() => Mouse(LDOWN);
    public static void LeftUp() => Mouse(LUP);

    public static void Key(ushort vk, bool down)
    {
        var input = new INPUT { type = 1, ki = new KEYBDINPUT { wVk = vk, dwFlags = down ? 0 : KEYUP } };
        SendInput(1, [input], Marshal.SizeOf<INPUT>());
    }
}
