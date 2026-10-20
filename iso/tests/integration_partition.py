"""Destructive operations are restricted to a freshly created disposable loop disk."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def main():
    repository = Path(__file__).resolve().parents[2]
    os.environ["AOS_PUBLIC_ROOT"] = str(repository / "public")
    spec = importlib.util.spec_from_file_location(
        "aos_server", repository / "iso/config/includes.chroot/usr/local/lib/aos/server.py",
    )
    server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(server)
    with tempfile.TemporaryDirectory(prefix="aos-installer-test-") as directory:
        image = Path(directory) / "disposable.raw"
        marker = Path(directory) / "keep.txt"
        marker.write_text("Existing Windows volume data must survive.\n")
        with image.open("wb") as stream:
            stream.truncate(70 * server.GIB)
        loop = command("losetup", "--find", "--show", "--partscan", str(image))
        if not loop.startswith("/dev/loop"):
            raise RuntimeError("Refusing to test on a non-loop device")
        try:
            command("parted", "-s", loop, "mklabel", "gpt")
            command("parted", "-s", loop, "unit", "MiB", "mkpart", "Windows", "ntfs", "1", str(69 * 1024))
            command("partprobe", loop)
            command("udevadm", "settle")
            partition = loop + "p1"
            command("mkntfs", "--quick", "--force", partition)
            command("ntfscp", partition, str(marker), "/keep.txt")
            command("udevadm", "trigger", "--action=change", "/sys/class/block/" + Path(partition).name)
            command("udevadm", "settle")
            original = server.partition_geometry(loop, 1)
            print("Detected test partitions:", server.list_partitions(loop), flush=True)
            assert server.list_partitions(loop)[0]["partn"] == 1
            prepared = server.create_alongside_space({
                "disk": loop, "resizePartition": partition,
                "resizePartitionNumber": 1, "autoCreateSpace": True,
            })
            assert prepared["size"] >= server.MIN_ALONGSIDE_BYTES
            resized = server.partition_geometry(loop, 1)
            assert resized["start"] == original["start"]
            assert resized["end"] < original["end"]
            assert command("ntfscat", partition, "/keep.txt") == marker.read_text().strip()
            path, number = server.create_partition(
                loop, "AOS_TEST", prepared["startMiB"], prepared["endMiB"],
            )
            assert path == loop + "p2" and number == 2
            assert command("ntfscat", partition, "/keep.txt") == marker.read_text().strip()
            print("PASS: real NTFS resize, data preservation, partition discovery and creation")
        finally:
            command("losetup", "-d", loop)


if __name__ == "__main__":
    main()
