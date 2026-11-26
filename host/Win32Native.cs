using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;

namespace KuroDesk
{
    internal static class Win32Native
    {
        public const int GWL_STYLE = -16;
        public const int GWL_EXSTYLE = -20;

        public const int WS_CAPTION = 0x00C00000;
        public const int WS_THICKFRAME = 0x00040000;

        public const int WS_EX_LAYERED = 0x00080000;
        public const int WS_EX_TRANSPARENT = 0x00000020;
        public const int WS_EX_TOPMOST = 0x00000008;
        public const int WS_EX_TOOLWINDOW = 0x00000080;

        public const uint LWA_ALPHA = 0x00000002;

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        public const uint SWP_NOACTIVATE = 0x0010;
        public const uint SWP_FRAMECHANGED = 0x0020;

        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
        public static readonly IntPtr HWND_BROADCAST = new IntPtr(0xFFFF);

        public const int WM_HOTKEY = 0x0312;

        // DWM attributes
        public const uint DWM_BB_ENABLE = 0x00000001;
        public const uint DWM_BB_BLURREGION = 0x00000002;
        public const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;
        public const int DWMWA_CLOAKED = 14;
        public const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

        // Low-level hooks
        public const int WH_KEYBOARD_LL = 13;
        public const int WH_MOUSE_LL = 14;

        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;
        public const int WM_SYSKEYDOWN = 0x0104;
        public const int WM_SYSKEYUP = 0x0105;

        public const int WM_MOUSEMOVE = 0x0200;
        public const int WM_LBUTTONDOWN = 0x0201;
        public const int WM_LBUTTONUP = 0x0202;
        public const int WM_RBUTTONDOWN = 0x0204;
        public const int WM_RBUTTONUP = 0x0205;
        public const int WM_MBUTTONDOWN = 0x0207;
        public const int WM_MBUTTONUP = 0x0208;
        public const int WM_MOUSEWHEEL = 0x020A;

        // Hotkey modifiers
        public const uint MOD_ALT = 0x0001;
        public const uint MOD_CONTROL = 0x0002;
        public const uint MOD_NOREPEAT = 0x4000;

        // Virtual screen metrics
        public const int SM_XVIRTUALSCREEN = 76;
        public const int SM_YVIRTUALSCREEN = 77;
        public const int SM_CXVIRTUALSCREEN = 78;
        public const int SM_CYVIRTUALSCREEN = 79;

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
        public const uint SRCCOPY = 0x00CC0020;

        public static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct DWM_BLURBEHIND
        {
            public uint dwFlags;
            [MarshalAs(UnmanagedType.Bool)]
            public bool fEnable;
            public IntPtr hRgnBlur;
            [MarshalAs(UnmanagedType.Bool)]
            public bool fTransitionOnMaximized;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        public delegate IntPtr LowLevelHookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelHookProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("kernel32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
        public static extern IntPtr GetProcAddress(IntPtr hModule, string procName);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool QueryFullProcessImageName(IntPtr hProcess, uint dwFlags, StringBuilder lpExeName, ref uint lpdwSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool CloseHandle(IntPtr hObject);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool UnregisterHotKey(IntPtr hWnd, int id);

        [DllImport("dwmapi.dll")]
        public static extern int DwmEnableBlurBehindWindow(IntPtr hWnd, ref DWM_BLURBEHIND pBlurBehind);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out RECT pvAttribute, int cbAttribute);

        [DllImport("dwmapi.dll")]
        public static extern int DwmGetWindowAttribute(IntPtr hWnd, int dwAttribute, out int pvAttribute, int cbAttribute);

        [DllImport("dwmapi.dll")]
        public static extern int DwmSetWindowAttribute(IntPtr hWnd, int dwAttribute, ref int pvAttribute, int cbAttribute);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateRectRgn(int nLeftRect, int nTopRect, int nRightRect, int nBottomRect);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DeleteObject(IntPtr hObject);

        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DeleteDC(IntPtr hdc);

        [DllImport("gdi32.dll")]
        public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

        [DllImport("gdi32.dll")]
        public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

        [DllImport("gdi32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight,
            IntPtr hdcSrc, int nXSrc, int nYSrc, uint dwRop);

        [StructLayout(LayoutKind.Sequential)]
        public struct BITMAPINFOHEADER
        {
            public uint biSize;
            public int biWidth;
            public int biHeight;
            public ushort biPlanes;
            public ushort biBitCount;
            public uint biCompression;
            public uint biSizeImage;
            public int biXPelsPerMeter;
            public int biYPelsPerMeter;
            public uint biClrUsed;
            public uint biClrImportant;
        }

        [DllImport("gdi32.dll")]
        public static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint uStartScan, uint cScanLines,
            [Out] byte[] lpvBits, ref BITMAPINFOHEADER lpbi, uint uUsage);

        [DllImport("ole32.dll")]
        public static extern void CoTaskMemFree(IntPtr pv);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DestroyIcon(IntPtr hIcon);

        public static void EnableTransparentComposition(IntPtr hwnd)
        {
            IntPtr rgn = CreateRectRgn(0, 0, -1, -1);
            try
            {
                DWM_BLURBEHIND bb = new DWM_BLURBEHIND();
                bb.dwFlags = DWM_BB_ENABLE | DWM_BB_BLURREGION;
                bb.fEnable = true;
                bb.hRgnBlur = rgn;
                bb.fTransitionOnMaximized = false;
                DwmEnableBlurBehindWindow(hwnd, ref bb);
            }
            finally
            {
                if (rgn != IntPtr.Zero) DeleteObject(rgn);
            }
        }

        public static void SetDarkTitleBar(IntPtr hwnd, bool dark)
        {
            try
            {
                int val = dark ? 1 : 0;
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref val, sizeof(int));
            }
            catch { }
        }

        public static void EnableDarkTitleBar(IntPtr hwnd)
        {
            SetDarkTitleBar(hwnd, true);
        }

        public static void SetClickThrough(IntPtr hwnd, bool enabled)
        {
            int exStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
            if (enabled) exStyle |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
            else exStyle &= ~(WS_EX_TRANSPARENT | WS_EX_LAYERED);
            SetWindowLong(hwnd, GWL_EXSTYLE, exStyle);
            if (enabled)
            {
                SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
            }
            SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }

        public static string GetWindowClassName(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "";
            StringBuilder sb = new StringBuilder(128);
            int n = GetClassName(hwnd, sb, sb.Capacity);
            return n > 0 ? sb.ToString(0, n) : "";
        }

        public static bool IsWindowCloaked(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            int cloaked = 0;
            return DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, out cloaked, sizeof(int)) == 0 && cloaked != 0;
        }

        public static void SetAlwaysOnTop(IntPtr hwnd, bool topMost)
        {
            SetWindowPos(hwnd, topMost ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        public static bool TryGetVisibleWindowBounds(IntPtr hwnd, out RECT rect)
        {
            if (DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, out rect, Marshal.SizeOf(typeof(RECT))) == 0
                && rect.Right > rect.Left && rect.Bottom > rect.Top)
            {
                return true;
            }
            return GetWindowRect(hwnd, out rect) && rect.Right > rect.Left && rect.Bottom > rect.Top;
        }

        public static string GetProcessNameFromHwnd(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return "";
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return "";
            IntPtr proc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (proc == IntPtr.Zero) return "";
            try
            {
                StringBuilder sb = new StringBuilder(512);
                uint len = (uint)sb.Capacity;
                if (QueryFullProcessImageName(proc, 0, sb, ref len) && len > 0)
                {
                    string path = sb.ToString(0, (int)len);
                    int slash = path.LastIndexOf('\\');
                    string file = slash >= 0 ? path.Substring(slash + 1) : path;
                    return file.ToLowerInvariant();
                }
            }
            finally
            {
                CloseHandle(proc);
            }
            return "";
        }

        /// <summary>
        /// Lightweight off-thread-safe perimeter screen ambient color sampler using a single 8x1 memory DIB BitBlt.
        /// Avoids synchronous per-pixel GetPixel stalls on the UI thread.
        /// </summary>
        public static Color SamplePerimeterAmbientColor(RECT rect)
        {
            IntPtr hdcScreen = GetDC(IntPtr.Zero);
            if (hdcScreen == IntPtr.Zero) return Color.FromArgb(40, 44, 54);
            IntPtr hdcMem = IntPtr.Zero;
            IntPtr hBmp = IntPtr.Zero;
            IntPtr hOld = IntPtr.Zero;
            try
            {
                int vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
                int vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
                int vw = Math.Max(1, GetSystemMetrics(SM_CXVIRTUALSCREEN));
                int vh = Math.Max(1, GetSystemMetrics(SM_CYVIRTUALSCREEN));

                int mx = (rect.Left + rect.Right) / 2;
                int my = (rect.Top + rect.Bottom) / 2;
                int pad = 12;

                int[][] pts = {
                    new[] { rect.Left - pad, my },
                    new[] { rect.Right + pad, my },
                    new[] { mx, rect.Top - pad },
                    new[] { mx, rect.Bottom + pad },
                    new[] { rect.Left - pad, rect.Top - pad },
                    new[] { rect.Right + pad, rect.Top - pad },
                    new[] { rect.Left - pad, rect.Bottom + pad },
                    new[] { rect.Right + pad, rect.Bottom + pad },
                };

                hdcMem = CreateCompatibleDC(hdcScreen);
                if (hdcMem == IntPtr.Zero) return Color.FromArgb(40, 44, 54);
                hBmp = CreateCompatibleBitmap(hdcScreen, pts.Length, 1);
                if (hBmp == IntPtr.Zero) return Color.FromArgb(40, 44, 54);
                hOld = SelectObject(hdcMem, hBmp);

                for (int i = 0; i < pts.Length; i++)
                {
                    int x = Math.Max(vx, Math.Min(vx + vw - 1, pts[i][0]));
                    int y = Math.Max(vy, Math.Min(vy + vh - 1, pts[i][1]));
                    BitBlt(hdcMem, i, 0, 1, 1, hdcScreen, x, y, SRCCOPY);
                }

                BITMAPINFOHEADER bi = new BITMAPINFOHEADER();
                bi.biSize = (uint)Marshal.SizeOf(typeof(BITMAPINFOHEADER));
                bi.biWidth = pts.Length;
                bi.biHeight = -1;
                bi.biPlanes = 1;
                bi.biBitCount = 32;
                bi.biCompression = 0; // BI_RGB

                byte[] bgra = new byte[pts.Length * 4];
                if (GetDIBits(hdcMem, hBmp, 0, 1, bgra, ref bi, 0) == 0)
                    return Color.FromArgb(40, 44, 54);

                long sumR = 0, sumG = 0, sumB = 0;
                for (int i = 0; i < pts.Length; i++)
                {
                    sumB += bgra[i * 4 + 0];
                    sumG += bgra[i * 4 + 1];
                    sumR += bgra[i * 4 + 2];
                }
                return Color.FromArgb((int)(sumR / pts.Length), (int)(sumG / pts.Length), (int)(sumB / pts.Length));
            }
            finally
            {
                if (hdcMem != IntPtr.Zero)
                {
                    if (hOld != IntPtr.Zero) SelectObject(hdcMem, hOld);
                    DeleteDC(hdcMem);
                }
                if (hBmp != IntPtr.Zero) DeleteObject(hBmp);
                ReleaseDC(IntPtr.Zero, hdcScreen);
            }
        }
    }
}
