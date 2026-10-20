import importlib.util
import os
from pathlib import Path
from tempfile import TemporaryDirectory
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

    def test_windows_firmware_partition_uuid_parser(self):
        output = r"""BootCurrent: 0004
Boot0001* Windows Boot Manager HD(1,GPT,12345678-1234-4abc-9def-1234567890ab,0x800,0x32000)/File(\EFI\Microsoft\Boot\bootmgfw.efi)
"""
        with patch.object(SERVER, "run", return_value=(0, output, "")):
            self.assertEqual(
                SERVER.windows_firmware_partition_uuids(),
                {"12345678-1234-4abc-9def-1234567890ab"},
            )

    def test_windows_esp_accepts_firmware_entry_when_mount_probe_fails(self):
        device = {
            "children": [{
                "path": "/dev/nvme0n1p1",
                "parttype": SERVER.EFI_SYSTEM_GUID,
                "partuuid": "12345678-1234-4abc-9def-1234567890ab",
                "fstype": "",
            }],
        }
        with patch.object(SERVER, "windows_firmware_partition_uuids", return_value={"12345678-1234-4abc-9def-1234567890ab"}):
            with patch.object(SERVER, "partition_has_windows_loader", return_value=False):
                self.assertEqual(SERVER.windows_esp_for_disk(device), "/dev/nvme0n1p1")

    def test_windows_esp_probes_fat_partition_when_guid_is_missing(self):
        device = {
            "children": [{
                "path": "/dev/sda1",
                "parttype": "",
                "partuuid": "",
                "fstype": "vfat",
            }],
        }
        with patch.object(SERVER, "windows_firmware_partition_uuids", return_value=set()):
            with patch.object(SERVER, "partition_has_windows_loader", return_value=True):
                self.assertEqual(SERVER.windows_esp_for_disk(device), "/dev/sda1")

    def test_windows_system_partition_requires_the_windows_system_hive(self):
        device = {
            "children": [
                {"path": "/dev/nvme0n1p3", "partn": "3", "fstype": "ntfs", "size": 300 * SERVER.GIB},
                {"path": "/dev/nvme0n1p4", "partn": "4", "fstype": "ntfs", "size": 400 * SERVER.GIB},
            ],
        }
        with patch.object(SERVER, "partition_has_windows_installation", side_effect=lambda path: path == "/dev/nvme0n1p3"):
            selected = SERVER.windows_system_partition(device)
        self.assertEqual(selected["path"], "/dev/nvme0n1p3")

    def test_parted_partition_geometry_parser_uses_byte_offsets(self):
        output = """BYT;
/dev/nvme0n1:512110190592B:nvme:512:512:gpt:Disk:;
3:525336576B:500000000000B:499474663425B:ntfs:Basic data partition:msftdata;
"""
        geometry = SERVER.parse_parted_partitions(output)[3]
        self.assertEqual(geometry["start"], 525336576)
        self.assertEqual(geometry["end"], 500000000000)
        self.assertEqual(geometry["size"], 499474663425)

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
        self.assertEqual(targets[0]["name"], "Windows local disk (C:) - setup required")
        self.assertFalse(targets[0]["installable"])
        self.assertIn("32 GB", targets[0]["blockedReason"])

    def test_windows_disk_without_space_offers_automatic_partition_creation(self):
        windows_partition = {
            "path": "/dev/nvme0n1p3",
            "partn": "3",
            "fstype": "ntfs",
            "size": 400 * SERVER.GIB,
        }
        device = {
            "type": "disk",
            "rm": False,
            "path": "/dev/nvme0n1",
            "pttype": "gpt",
            "children": [windows_partition],
        }
        with patch.object(SERVER.os.path, "realpath", side_effect=lambda value: value):
            with patch.object(SERVER.Path, "is_dir", return_value=True):
                with patch.object(SERVER, "windows_esp_for_disk", return_value="/dev/nvme0n1p1"):
                    with patch.object(SERVER, "disk_free_regions", return_value=[]):
                        with patch.object(SERVER, "windows_system_partition", return_value=windows_partition):
                            targets = SERVER.alongside_targets([device], "/dev/sdb")
        self.assertEqual(len(targets), 1)
        self.assertTrue(targets[0]["installable"])
        self.assertTrue(targets[0]["autoCreateSpace"])
        self.assertEqual(targets[0]["id"], "alongside-auto:/dev/nvme0n1:3")
        self.assertEqual(targets[0]["resizePartition"], "/dev/nvme0n1p3")

    def test_automatic_partition_creation_checks_ntfs_before_resizing(self):
        item = {
            "disk": "/dev/nvme0n1",
            "resizePartition": "/dev/nvme0n1p3",
            "resizePartitionNumber": 3,
        }
        partition = {"path": "/dev/nvme0n1p3", "partn": "3", "fstype": "ntfs"}
        end = 450 * SERVER.GIB
        geometry = {"number": 3, "start": SERVER.GIB, "end": end - 1, "size": end - SERVER.GIB}
        region = {"startMiB": 417788, "endMiB": 450560, "size": 32772 * SERVER.MIB}

        def command_result(command, timeout=SERVER.COMMAND_TIMEOUT):
            if command[0] == "ntfsresize":
                return 0, "The read-only test succeeded", ""
            return 0, "", ""

        with patch.object(SERVER, "list_partitions", return_value=[partition]):
            with patch.object(SERVER, "mounted_path", return_value=""):
                with patch.object(SERVER, "partition_geometry", return_value=geometry):
                    with patch.object(SERVER, "run", side_effect=command_result) as run_command:
                        with patch.object(SERVER, "require_command", return_value="") as require:
                            with patch.object(SERVER, "disk_free_regions", return_value=[region]):
                                with patch.object(SERVER.time, "sleep"):
                                    prepared = SERVER.create_alongside_space(item)

        self.assertEqual(prepared["startMiB"], region["startMiB"])
        self.assertEqual(prepared["endMiB"], region["endMiB"])
        self.assertFalse(prepared["autoCreateSpace"])
        self.assertEqual(run_command.call_args_list[0].args[0][0:3], ["ntfsresize", "--no-action", "--no-progress-bar"])
        self.assertEqual(require.call_args_list[0].args[0][0:2], ["ntfsresize", "--force"])
        self.assertIn("resizepart", require.call_args_list[1].args[0])

    def test_automatic_partition_creation_stops_when_ntfs_check_fails(self):
        item = {
            "disk": "/dev/sda",
            "resizePartition": "/dev/sda3",
            "resizePartitionNumber": 3,
        }
        partition = {"path": "/dev/sda3", "partn": "3", "fstype": "ntfs"}
        geometry = {"number": 3, "start": SERVER.GIB, "end": 200 * SERVER.GIB - 1, "size": 199 * SERVER.GIB}
        with patch.object(SERVER, "list_partitions", return_value=[partition]):
            with patch.object(SERVER, "mounted_path", return_value=""):
                with patch.object(SERVER, "partition_geometry", return_value=geometry):
                    with patch.object(SERVER, "run", return_value=(1, "", "NTFS is hibernated")):
                        with patch.object(SERVER, "require_command") as require:
                            with self.assertRaisesRegex(RuntimeError, "safety check failed"):
                                SERVER.create_alongside_space(item)
        require.assert_not_called()

    def test_legacy_boot_still_reports_windows_and_requests_uefi(self):
        device = {
            "type": "disk",
            "rm": False,
            "path": "/dev/nvme0n1",
            "pttype": "gpt",
            "children": [],
        }
        region = {"startMiB": 200000, "endMiB": 240000, "size": 40000 * SERVER.MIB}
        with patch.object(SERVER.Path, "is_dir", return_value=False):
            with patch.object(SERVER, "windows_esp_for_disk", return_value="/dev/nvme0n1p1"):
                with patch.object(SERVER, "disk_free_regions", return_value=[region]):
                    targets = SERVER.alongside_targets([device], "/dev/sdb")
        self.assertEqual(len(targets), 1)
        self.assertFalse(targets[0]["installable"])
        self.assertIn("UEFI entry", targets[0]["blockedReason"])
        self.assertIn("Windows detected", targets[0]["description"])

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

    def test_volume_state_reads_pipewire_default_sink(self):
        with patch.object(SERVER, "run_as_aos", return_value=(0, "Volume: 0.65 [MUTED]", "")):
            state = SERVER.volume_state()
        self.assertTrue(state["available"])
        self.assertEqual(state["percentage"], 65)
        self.assertTrue(state["muted"])

    def test_set_volume_changes_pipewire_volume_and_mute(self):
        with patch.object(SERVER, "run_as_aos", return_value=(0, "", "")) as command:
            with patch.object(SERVER, "volume_state", return_value={"available": True, "percentage": 42, "muted": False}):
                state = SERVER.set_volume(42)
        self.assertEqual(state["percentage"], 42)
        self.assertEqual(command.call_args_list, [
            call(["wpctl", "set-volume", "@DEFAULT_AUDIO_SINK@", "42%"], timeout=5),
            call(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "0"], timeout=5),
        ])

    def test_brightness_state_and_write_use_hardware_backlight(self):
        original_root = SERVER.BACKLIGHT_ROOT
        with TemporaryDirectory() as directory:
            root = Path(directory)
            device = root / "intel_backlight"
            device.mkdir()
            (device / "max_brightness").write_text("1000")
            (device / "brightness").write_text("600")
            SERVER.BACKLIGHT_ROOT = root
            try:
                self.assertEqual(SERVER.brightness_state(), {"available": True, "percentage": 60})
                self.assertEqual(SERVER.set_brightness(35), {"available": True, "percentage": 35})
                self.assertEqual((device / "brightness").read_text(), "350")
            finally:
                SERVER.BACKLIGHT_ROOT = original_root

    def test_iso_kiosk_starts_the_real_aos_page(self):
        script = (REPOSITORY / "iso/config/includes.chroot/etc/skel/.xinitrc").read_text(encoding="utf-8")
        self.assertIn("/a-os.html?aosLiveIso=1", script)
        self.assertNotIn("/index.html?aosLiveIso=1", script)


if __name__ == "__main__":
    unittest.main()
