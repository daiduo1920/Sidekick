using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace KuroDesk
{
    internal static class Program
    {
        public static uint WakeMessageId { get; private set; }

        [STAThread]
        private static int Main(string[] args)
        {
            WakeMessageId = Win32Native.RegisterWindowMessage("KuroDesk_WakeStudio_v2");

            try
            {
                if (!Win32Native.SetProcessDpiAwarenessContext(Win32Native.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
                {
                    Win32Native.SetProcessDPIAware();
                }
            }
            catch
            {
                try { Win32Native.SetProcessDPIAware(); } catch { }
            }

            bool debugMode = false;
            bool smokeTest = false;
            bool openStudio = false;
            string installCorePath = null;
            List<string> importPaths = new List<string>();

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg == "--debug") debugMode = true;
                else if (arg == "--smoke-test") smokeTest = true;
                else if (arg == "--studio") openStudio = true;
                else if (arg == "--install-core" && i + 1 < args.Length) installCorePath = args[++i];
                else if (arg == "--import" && i + 1 < args.Length) importPaths.Add(args[++i]);
            }

            if (!string.IsNullOrEmpty(installCorePath) || importPaths.Count > 0)
            {
                ConfigStore store = new ConfigStore();
                AssetManager assets = new AssetManager(store);
                string err;
                if (!string.IsNullOrEmpty(installCorePath))
                {
                    if (!assets.InstallCubismCoreFromPath(installCorePath, out err))
                    {
                        Console.Error.WriteLine(err ?? "Failed to install Cubism Core.");
                        return 1;
                    }
                }
                foreach (string p in importPaths)
                {
                    CustomAssetEntry entry = assets.ImportFile(p, "", out err);
                    if (entry == null)
                    {
                        Console.Error.WriteLine((err ?? "Failed to import: ") + " " + p);
                        return 1;
                    }
                }
                return 0;
            }

            bool createdNew;
            using (Mutex mutex = new Mutex(true, "KuroDesk_SingleInstance_v2", out createdNew))
            {
                if (!createdNew && !smokeTest)
                {
                    // Second launch immediately wakes the running instance and opens KuroStudio!
                    if (WakeMessageId != 0)
                    {
                        Win32Native.PostMessage(Win32Native.HWND_BROADCAST, WakeMessageId, IntPtr.Zero, IntPtr.Zero);
                    }
                    return 0;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);

                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string uiDir = Path.Combine(exeDir, "ui");
                if (!Directory.Exists(uiDir))
                {
                    string parentUi = Path.GetFullPath(Path.Combine(exeDir, "..", "ui"));
                    if (Directory.Exists(parentUi)) uiDir = parentUi;
                }

                if (!Directory.Exists(uiDir))
                {
                    MessageBox.Show("未找到 ui 资源目录：" + uiDir, "KuroDesk", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 1;
                }

                using (AppCoordinator app = new AppCoordinator(uiDir, debugMode, openStudio, smokeTest))
                {
                    Application.Run(app);
                }
            }
            return 0;
        }
    }
}
