import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import MagicMock, call, patch


REPOSITORY = Path(__file__).resolve().parents[2]
SERVER_PATH = REPOSITORY / "iso" / "config" / "includes.chroot" / "usr" / "local" / "lib" / "aos" / "server.py"
ORIGINAL_DIRECTORY = Path.cwd()
os.environ["AOS_PUBLIC_ROOT"] = str(REPOSITORY / "public")
SPEC = importlib.util.spec_from_file_location("aos_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
os.chdir(ORIGINAL_DIRECTORY)


class InstallerSafetyTests(unittest.TestCase):
    def tearDown(self):
        SERVER.invalidate_network_health()

    def test_parted_free_regions_are_aligned_inward(self):
        output = """BYT;
/dev/nvme0n1:256060514304B:nvme:512:512:gpt:Example:;
1:1048576B:537919487B:536870912B:fat32:EFI system partition:boot, esp;
:100000000001B:220000123456B:120000123456B:free;
"""
        regions = SERVER.parse_parted_free(output)
        self.assertEqual(len(regions), 1)
        region = regions[0]
        self.assertGreaterEqual(region["startMiB"] * SERVER.MIB, 100000000001)
        self.assertLessEqual(region["endMiB"] * SERVER.MIB, 220000123457)
        self.assertEqual(region["size"], (region["endMiB"] - region["startMiB"]) * SERVER.MIB)

    def test_parted_parser_ignores_existing_partitions(self):
        output = """BYT;
/dev/sda:128849018880B:scsi:512:512:gpt:Disk:;
1:1048576B:537919487B:536870912B:fat32:EFI:boot, esp;
2:537919488B:128848000000B:128310080513B:ntfs:Windows:msftdata;
"""
        self.assertEqual(SERVER.parse_parted_free(output), [])

    def test_alongside_target_rejects_a_command_path_before_enumeration(self):
        with patch.object(SERVER, "storage_targets") as targets:
            with self.assertRaisesRegex(RuntimeError, "unsafe"):
                SERVER.validate_alongside_target("alongside:/dev/sda;reboot:1:2")
            targets.assert_not_called()

    def test_windows_disk_without_space_is_reported_but_not_installable(self):
        device = {
            "type": "disk",
            "rm": False,
            "path": "/dev/nvme0n1",
            "pttype": "gpt",
            "children": [],
        }
        with patch.object(SERVER.Path, "is_dir", return_value=True):
            with patch.object(SERVER, "windows_esp_for_disk", return_value="/dev/nvme0n1p1"):
                with patch.object(SERVER, "disk_free_regions", return_value=[]):
                    targets = SERVER.alongside_targets([device], "/dev/sdb")
        self.assertEqual(len(targets), 1)
        self.assertEqual(targets[0]["name"], "Windows local disk (C:) - space required")
        self.assertFalse(targets[0]["installable"])
        self.assertIn("32 GB", targets[0]["blockedReason"])

    def test_grub_menu_keeps_windows_and_aos(self):
        config = SERVER.grub_configuration("aos-system-uuid", "windows-esp-uuid")
        self.assertIn("menuentry 'A-OS Desktop'", config)
        self.assertIn("live-media=/dev/disk/by-uuid/aos-system-uuid", config)
        self.assertIn("reboot=efi", config)
        self.assertIn("($aosroot)/live/vmlinuz", config)
        self.assertIn("/EFI/AOSDesktop/splash.png", config)
        self.assertIn("menuentry 'Windows Boot Manager'", config)
        self.assertIn("/EFI/Microsoft/Boot/bootmgfw.efi", config)

    def test_standalone_grub_uses_aos_3_system_uuid_only(self):
        config = SERVER.standalone_grub_configuration("aos-system-uuid")
        self.assertIn("menuentry 'A-OS Desktop 3.0'", config)
        self.assertIn("live-media=/dev/disk/by-uuid/aos-system-uuid", config)
        self.assertIn("($aosroot)/live/vmlinuz", config)
        self.assertNotIn("Windows Boot Manager", config)

    def test_live_usb_is_detected_as_installation_media(self):
        with patch.object(SERVER, "live_source_device", return_value="/dev/sdb"):
            with patch.object(SERVER, "run", return_value=(0, "1 usb\n", "")):
                self.assertTrue(SERVER.live_source_is_removable())

    def test_internal_source_is_not_detected_as_installation_media(self):
        with patch.object(SERVER, "live_source_device", return_value="/dev/nvme0n1"):
            with patch.object(SERVER, "run", return_value=(0, "0 nvme\n", "")):
                self.assertFalse(SERVER.live_source_is_removable())

    def test_efi_boot_order_parser(self):
        output = """BootCurrent: 0004
BootNext: 0007
BootOrder: 0001,0007,0004
Boot0001* Windows Boot Manager
Boot0007* A-OS
"""
        with patch.object(SERVER, "run", return_value=(0, output, "")):
            self.assertEqual(SERVER.efi_boot_order(), ["0001", "0007", "0004"])

    def test_prioritize_aos_boot_sets_permanent_and_next_boot(self):
        output = """BootCurrent: 0004
BootOrder: 0001,0007,0004
Boot0001* Windows Boot Manager
Boot0007* A-OS
"""
        with patch.object(SERVER, "run", return_value=(0, output, "")):
            with patch.object(SERVER, "require_command", return_value="") as command:
                SERVER.prioritize_aos_boot("0007")
        self.assertEqual(
            command.call_args_list,
            [
                call(["efibootmgr", "--bootorder", "0007,0001,0004"], timeout=10),
                call(["efibootmgr", "--bootnext", "0007"], timeout=10),
            ],
        )

    def test_prioritize_aos_boot_rejects_invalid_entry(self):
        with self.assertRaisesRegex(RuntimeError, "identify"):
            SERVER.prioritize_aos_boot("0007;reboot")

    def test_prioritize_aos_boot_keeps_existing_order_on_read_failure(self):
        with patch.object(SERVER, "run", return_value=(1, "", "firmware unavailable")):
            with patch.object(SERVER, "require_command") as command:
                with self.assertRaisesRegex(RuntimeError, "boot order"):
                    SERVER.prioritize_aos_boot("0007")
        command.assert_not_called()

    def test_network_health_reports_disabled_networking(self):
        with patch.object(SERVER, "networking_enabled", return_value=False):
            health = SERVER.network_health(force=True)
        self.assertFalse(health["online"])
        self.assertFalse(health["dns"])
        self.assertEqual(health["message"], "Internet access is off")

    def test_network_health_checks_dns_and_https(self):
        response = MagicMock()
        response.status = 200
        response.__enter__.return_value = response
        with patch.object(SERVER, "networking_enabled", return_value=True):
            with patch.object(SERVER.socket, "getaddrinfo", return_value=[("", "", "", "", "")]):
                with patch.object(SERVER, "urlopen", return_value=response):
                    health = SERVER.network_health(force=True)
        self.assertTrue(health["online"])
        self.assertTrue(health["dns"])
        self.assertEqual(health["message"], "Internet connection is working")


if __name__ == "__main__":
    unittest.main()
