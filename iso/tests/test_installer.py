import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import patch


REPOSITORY = Path(__file__).resolve().parents[2]
SERVER_PATH = REPOSITORY / "iso" / "config" / "includes.chroot" / "usr" / "local" / "lib" / "aos" / "server.py"
ORIGINAL_DIRECTORY = Path.cwd()
os.environ["AOS_PUBLIC_ROOT"] = str(REPOSITORY / "public")
SPEC = importlib.util.spec_from_file_location("aos_server", SERVER_PATH)
SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVER)
os.chdir(ORIGINAL_DIRECTORY)


class InstallerSafetyTests(unittest.TestCase):
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

    def test_grub_menu_keeps_windows_and_aos(self):
        config = SERVER.grub_configuration("aos-system-uuid", "windows-esp-uuid")
        self.assertIn("menuentry 'A-OS Desktop'", config)
        self.assertIn("live-media=/dev/disk/by-uuid/aos-system-uuid", config)
        self.assertIn("($aosroot)/live/vmlinuz", config)
        self.assertIn("menuentry 'Windows Boot Manager'", config)
        self.assertIn("/EFI/Microsoft/Boot/bootmgfw.efi", config)


if __name__ == "__main__":
    unittest.main()
