using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

namespace KuroDesk
{
    internal sealed class SystemSnapshot
    {
        public string ProcessName = "";
        public string AppCategory = "general"; // coding | gaming | media | creative | general
        public bool IsLateNight = false;
        public bool HasDockTarget = false;
        public Win32Native.RECT TargetRect;
        public bool IsTargetFullscreen = false;
        public Color AmbientColor = Color.FromArgb(40, 44, 54);
        public double AmbientLuminance = 0.2;
    }

    /// <summary>
    /// Samples local foreground app category (privacy-safe process name only),
    /// active window visible DWM bounds (for Window-Peek magnetic docking),
    /// and off-thread perimeter wallpaper ambient color (zero UI-thread DWM stalls).
    /// </summary>
    internal sealed class SystemContextMonitor
    {
        private static readonly HashSet<string> CodingProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "code.exe", "code - insiders.exe", "cursor.exe", "pycharm64.exe", "idea64.exe",
            "webstorm64.exe", "rider64.exe", "clion64.exe", "goland64.exe", "devenv.exe",
            "windowsterminal.exe", "wt.exe", "powershell.exe", "pwsh.exe", "cmd.exe",
            "sublime_text.exe", "notepad++.exe", "windsurf.exe", "zed.exe"
        };

        private static readonly HashSet<string> GamingProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "steam.exe", "steamwebhelper.exe", "cs2.exe", "valorant-win64-shipping.exe",
            "league of legends.exe", "leagueclientux.exe", "genshinimpact.exe", "yuanshen.exe",
            "starrail.exe", "eldenring.exe", "cyberpunk2077.exe", "dota2.exe", "overwatch.exe",
            "r5apex.exe", "javaw.exe", "minecraft.windows.exe", "naraka.exe", "pubg.exe",
            "tslgame.exe", "blackmythwukong.exe", "b1-win64-shipping.exe", "epicgameslauncher.exe"
        };

        private static readonly HashSet<string> MediaProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "cloudmusic.exe", "spotify.exe", "qqmusic.exe", "kugou.exe", "foobar2000.exe",
            "bilibili.exe", "potplayermini64.exe", "potplayermini.exe", "vlc.exe", "mpv.exe",
            "applemusic.exe", "itunes.exe", "qqplayer.exe", "iqiyivideo.exe", "youkumedia.exe"
        };

        private static readonly HashSet<string> CreativeProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "photoshop.exe", "illustrator.exe", "afterfx.exe", "adobe premiere pro.exe",
            "blender.exe", "figma.exe", "jianyingpro.exe", "capcut.exe", "krita.exe",
            "clipstudiopaint.exe", "sai2.exe", "sai.exe", "zbrush.exe", "cinema 4d.exe",
            "maya.exe", "3dsmax.exe", "resolve.exe", "aseprite.exe", "live2d_cubism_editor.exe"
        };

        private static readonly HashSet<string> IgnoredDockProcs = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "shellexperiencehost.exe", "searchhost.exe", "startmenuexperiencehost.exe",
            "taskmgr.exe", "lockapp.exe"
        };

        private static readonly HashSet<string> IgnoredShellClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "NotifyIconOverflowWindow"
        };

        private IntPtr _lastValidDockHwnd = IntPtr.Zero;
        private string _lastExternalProc = "";
        private string _lastExternalCat = "general";

        private volatile float _smoothR = 45f;
        private volatile float _smoothG = 50f;
        private volatile float _smoothB = 62f;
        private int _ambientTickCounter = 0;
        private int _ambientSampling = 0;

        public SystemSnapshot Poll(IntPtr petHwnd, IntPtr studioHwnd, bool sampleAmbient)
        {
            SystemSnapshot snap = new SystemSnapshot();
            int hour = DateTime.Now.Hour;
            snap.IsLateNight = (hour >= 22 || hour < 6);

            IntPtr fg = Win32Native.GetForegroundWindow();
            bool isSelfWindow = (fg != IntPtr.Zero && (fg == petHwnd || fg == studioHwnd));

            if (isSelfWindow)
            {
                // Keep the last real foreground app category when user opens Studio or drags Pet!
                snap.ProcessName = _lastExternalProc;
                snap.AppCategory = _lastExternalCat;
            }
            else if (fg != IntPtr.Zero && Win32Native.IsWindowVisible(fg) && !Win32Native.IsIconic(fg) && !Win32Native.IsWindowCloaked(fg))
            {
                string proc = Win32Native.GetProcessNameFromHwnd(fg);
                string cls = Win32Native.GetWindowClassName(fg);
                bool isDesktopShell = IgnoredShellClasses.Contains(cls);

                if (!isDesktopShell)
                {
                    _lastExternalProc = proc;
                    _lastExternalCat = ClassifyProcess(proc);
                }
                snap.ProcessName = _lastExternalProc;
                snap.AppCategory = _lastExternalCat;

                if (!isDesktopShell && !IgnoredDockProcs.Contains(proc))
                {
                    Win32Native.RECT rc;
                    if (Win32Native.TryGetVisibleWindowBounds(fg, out rc))
                    {
                        int w = rc.Right - rc.Left;
                        int h = rc.Bottom - rc.Top;
                        if (w >= 320 && h >= 200)
                        {
                            _lastValidDockHwnd = fg;
                            snap.TargetRect = rc;
                            snap.HasDockTarget = true;
                            snap.IsTargetFullscreen = CheckFullscreen(fg, rc);
                        }
                    }
                }
            }
            else
            {
                snap.ProcessName = _lastExternalProc;
                snap.AppCategory = _lastExternalCat;
            }

            // Fallback to last tracked non-self window if user clicked pet/studio (but not if all windows minimized)
            if (!snap.HasDockTarget && _lastValidDockHwnd != IntPtr.Zero
                && Win32Native.IsWindowVisible(_lastValidDockHwnd)
                && !Win32Native.IsIconic(_lastValidDockHwnd)
                && !Win32Native.IsWindowCloaked(_lastValidDockHwnd))
            {
                Win32Native.RECT rc;
                if (Win32Native.TryGetVisibleWindowBounds(_lastValidDockHwnd, out rc))
                {
                    if (rc.Right - rc.Left >= 320 && rc.Bottom - rc.Top >= 200)
                    {
                        snap.TargetRect = rc;
                        snap.HasDockTarget = true;
                        snap.IsTargetFullscreen = CheckFullscreen(_lastValidDockHwnd, rc);
                    }
                }
            }

            // Off-thread perimeter ambient color sampling every ~2 seconds (every 9th poll) -> zero UI-thread DWM stalls!
            _ambientTickCounter++;
            if (sampleAmbient && petHwnd != IntPtr.Zero && (_ambientTickCounter % 9 == 1))
            {
                Win32Native.RECT petRc;
                if (Win32Native.GetWindowRect(petHwnd, out petRc)
                    && Interlocked.CompareExchange(ref _ambientSampling, 1, 0) == 0)
                {
                    Win32Native.RECT capturedRc = petRc;
                    ThreadPool.QueueUserWorkItem(delegate
                    {
                        try
                        {
                            Color c = Win32Native.SamplePerimeterAmbientColor(capturedRc);
                            _smoothR = _smoothR * 0.62f + c.R * 0.38f;
                            _smoothG = _smoothG * 0.62f + c.G * 0.38f;
                            _smoothB = _smoothB * 0.62f + c.B * 0.38f;
                        }
                        catch { }
                        finally
                        {
                            Interlocked.Exchange(ref _ambientSampling, 0);
                        }
                    });
                }
            }

            float sr = _smoothR, sg = _smoothG, sb = _smoothB;
            snap.AmbientColor = Color.FromArgb((int)sr, (int)sg, (int)sb);
            snap.AmbientLuminance = (0.2126 * sr + 0.7152 * sg + 0.0722 * sb) / 255.0;
            return snap;
        }

        private static string ClassifyProcess(string proc)
        {
            if (string.IsNullOrEmpty(proc)) return "general";
            if (CodingProcs.Contains(proc)) return "coding";
            if (GamingProcs.Contains(proc)) return "gaming";
            if (MediaProcs.Contains(proc)) return "media";
            if (CreativeProcs.Contains(proc)) return "creative";
            return "general";
        }

        private static bool CheckFullscreen(IntPtr hwnd, Win32Native.RECT rc)
        {
            Screen scr = Screen.FromRectangle(new Rectangle(rc.Left, rc.Top, Math.Max(1, rc.Right - rc.Left), Math.Max(1, rc.Bottom - rc.Top)));
            Rectangle b = scr.Bounds;
            bool coversMonitor = (rc.Left <= b.Left + 2 && rc.Top <= b.Top + 2 && rc.Right >= b.Right - 2 && rc.Bottom >= b.Bottom - 2);
            if (!coversMonitor) return false;

            // Avoid misclassifying regular maximized windows on monitors with auto-hidden taskbar
            int style = Win32Native.GetWindowLong(hwnd, Win32Native.GWL_STYLE);
            bool hasCaption = (style & Win32Native.WS_CAPTION) == Win32Native.WS_CAPTION;
            return !hasCaption;
        }
    }
}
