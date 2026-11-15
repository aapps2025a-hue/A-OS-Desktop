from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import urlopen

from filedrop.filedrop_service import FileDropService, Peer, safe_filename, unique_path


def wait_for(predicate, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError("Timed out waiting for FileDrop state")


class FileDropHelpersTest(unittest.TestCase):
    def test_safe_filename_removes_paths_and_windows_characters(self):
        self.assertEqual(safe_filename("../../folder/hello?.txt"), "hello_.txt")
        self.assertEqual(safe_filename("..\\..\\report:final.pdf"), "report_final.pdf")

    def test_unique_path_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "photo.jpg").write_bytes(b"one")
            self.assertEqual(unique_path(root, "photo.jpg").name, "photo (2).jpg")

    def test_device_name_and_enabled_state_persist(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / "state"
            first = FileDropService(state_dir=state, downloads_dir=Path(directory) / "downloads", enable_discovery=False)
            first.set_name("Living Room A-OS")
            first.set_enabled(False)
            second = FileDropService(state_dir=state, downloads_dir=Path(directory) / "downloads", enable_discovery=False)
            self.assertEqual(second.name, "Living Room A-OS")
            self.assertFalse(second.enabled)


class FileDropTransferTest(unittest.TestCase):
    def test_transfer_requires_approval_and_verifies_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sender = FileDropService(
                state_dir=root / "sender-state",
                downloads_dir=root / "sender-downloads",
                name="Sender",
                service_port=0,
                enable_discovery=False,
                bind_host="127.0.0.1",
            ).start()
            receiver = FileDropService(
                state_dir=root / "receiver-state",
                downloads_dir=root / "receiver-downloads",
                name="Receiver",
                service_port=0,
                enable_discovery=False,
                bind_host="127.0.0.1",
            ).start()
            try:
                sender.peers[receiver.device_id] = Peer(
                    id=receiver.device_id,
                    name=receiver.name,
                    platform=receiver.platform,
                    host="127.0.0.1",
                    port=receiver.service_port,
                    token=receiver.session_token,
                    seen=time.time(),
                )
                source = root / "hello.txt"
                source.write_text("FileDrop works between systems.\n", encoding="utf-8")
                outgoing_id = sender.queue_file(receiver.device_id, source)

                incoming = wait_for(
                    lambda: next(
                        (item for item in receiver.snapshot()["transfers"] if item["state"] == "pending"),
                        None,
                    )
                )
                self.assertEqual(sender.snapshot()["transfers"][0]["state"], "waiting")
                self.assertTrue(receiver.accept(incoming["id"]))

                wait_for(
                    lambda: next(
                        (
                            item
                            for item in sender.snapshot()["transfers"]
                            if item["id"] == outgoing_id and item["state"] == "complete"
                        ),
                        None,
                    )
                )
                received = root / "receiver-downloads" / "hello.txt"
                self.assertEqual(received.read_bytes(), source.read_bytes())
                incoming_done = next(item for item in receiver.snapshot()["transfers"] if item["id"] == incoming["id"])
                self.assertEqual(incoming_done["state"], "complete")
                self.assertEqual(incoming_done["progress"], 100)
                with urlopen(
                    f"http://127.0.0.1:{receiver.service_port}/api/transfers/{incoming['id']}/content",
                    timeout=3,
                ) as response:
                    self.assertEqual(response.read(), source.read_bytes())
            finally:
                sender.stop()
                receiver.stop()


if __name__ == "__main__":
    unittest.main()
