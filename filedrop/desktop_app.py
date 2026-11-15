#!/usr/bin/env python3
"""Windows and macOS desktop interface for A-OS FileDrop."""

from __future__ import annotations

import os
import platform
import subprocess
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

try:
    from .filedrop_service import FileDropService, human_size
except ImportError:
    from filedrop_service import FileDropService, human_size


BG = "#f4f7fb"
SURFACE = "#ffffff"
INK = "#172033"
MUTED = "#657089"
BLUE = "#315efb"
BLUE_DARK = "#2448c9"
GREEN = "#138a5b"
RED = "#c43d4b"
LINE = "#dce3ef"


class FileDropApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("A-OS FileDrop")
        self.root.geometry("820x610")
        self.root.minsize(680, 500)
        self.root.configure(bg=BG)
        self.service = FileDropService().start()
        self.prompted: set[str] = set()
        self.peer_rows: list[str] = []
        self.selected_files: list[Path] = []
        self._build_style()
        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.refresh()

    def _build_style(self) -> None:
        style = ttk.Style(self.root)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TFrame", background=BG)
        style.configure("Card.TFrame", background=SURFACE, relief="flat")
        style.configure("TLabel", background=BG, foreground=INK, font=("Segoe UI", 10))
        style.configure("Title.TLabel", background=BG, foreground=INK, font=("Segoe UI Semibold", 22))
        style.configure("Subtitle.TLabel", background=BG, foreground=MUTED, font=("Segoe UI", 10))
        style.configure("CardTitle.TLabel", background=SURFACE, foreground=INK, font=("Segoe UI Semibold", 12))
        style.configure("CardText.TLabel", background=SURFACE, foreground=MUTED, font=("Segoe UI", 9))
        style.configure("Accent.TButton", background=BLUE, foreground="white", borderwidth=0, padding=(15, 9))
        style.map("Accent.TButton", background=[("active", BLUE_DARK), ("disabled", "#aebce8")])
        style.configure("Quiet.TButton", background="#e9eef8", foreground=INK, borderwidth=0, padding=(12, 8))
        style.map("Quiet.TButton", background=[("active", "#dce5f5")])
        style.configure("TCheckbutton", background=BG, foreground=INK, font=("Segoe UI", 10))
        style.configure("TEntry", padding=7, fieldbackground="white", bordercolor=LINE)
        style.configure("Treeview", rowheight=30, background=SURFACE, fieldbackground=SURFACE, borderwidth=0)
        style.configure("Treeview.Heading", font=("Segoe UI Semibold", 9), foreground=MUTED)

    def _build_ui(self) -> None:
        main = ttk.Frame(self.root, padding=24)
        main.pack(fill="both", expand=True)

        header = ttk.Frame(main)
        header.pack(fill="x")
        title_box = ttk.Frame(header)
        title_box.pack(side="left", fill="x", expand=True)
        ttk.Label(title_box, text="FileDrop", style="Title.TLabel").pack(anchor="w")
        ttk.Label(title_box, text="Send files between A-OS, Windows, and macOS on this network.", style="Subtitle.TLabel").pack(anchor="w", pady=(2, 0))
        self.enabled_var = tk.BooleanVar(value=self.service.enabled)
        ttk.Checkbutton(header, text="Discoverable", variable=self.enabled_var, command=self.toggle_enabled).pack(side="right", padx=(16, 0))

        identity = ttk.Frame(main, style="Card.TFrame", padding=15)
        identity.pack(fill="x", pady=(18, 12))
        ttk.Label(identity, text="This device", style="CardTitle.TLabel").pack(side="left")
        self.name_var = tk.StringVar(value=self.service.name)
        name_entry = ttk.Entry(identity, textvariable=self.name_var, width=32)
        name_entry.pack(side="left", padx=16)
        name_entry.bind("<Return>", lambda _event: self.save_name())
        ttk.Button(identity, text="Save name", style="Quiet.TButton", command=self.save_name).pack(side="left")
        self.status_label = ttk.Label(identity, text="Ready", style="CardText.TLabel")
        self.status_label.pack(side="right")

        body = ttk.Frame(main)
        body.pack(fill="both", expand=True)
        left = ttk.Frame(body, style="Card.TFrame", padding=15)
        left.pack(side="left", fill="both", expand=True, padx=(0, 6))
        right = ttk.Frame(body, style="Card.TFrame", padding=15)
        right.pack(side="left", fill="both", expand=True, padx=(6, 0))

        ttk.Label(left, text="Nearby devices", style="CardTitle.TLabel").pack(anchor="w")
        ttk.Label(left, text="Only devices with FileDrop enabled appear here.", style="CardText.TLabel").pack(anchor="w", pady=(2, 10))
        self.devices = tk.Listbox(
            left,
            bg=SURFACE,
            fg=INK,
            selectbackground="#dce6ff",
            selectforeground=INK,
            borderwidth=1,
            relief="solid",
            highlightthickness=0,
            activestyle="none",
            font=("Segoe UI", 11),
            height=8,
        )
        self.devices.pack(fill="both", expand=True)

        file_bar = ttk.Frame(left, style="Card.TFrame")
        file_bar.pack(fill="x", pady=(10, 0))
        ttk.Button(file_bar, text="Choose files", style="Quiet.TButton", command=self.choose_files).pack(side="left")
        self.send_button = ttk.Button(file_bar, text="Send", style="Accent.TButton", command=self.send_files)
        self.send_button.pack(side="right")
        self.file_label = ttk.Label(left, text="No files selected", style="CardText.TLabel")
        self.file_label.pack(anchor="w", pady=(7, 0))

        ttk.Label(right, text="Activity", style="CardTitle.TLabel").pack(anchor="w")
        ttk.Label(right, text="Incoming requests and transfer progress.", style="CardText.TLabel").pack(anchor="w", pady=(2, 10))
        columns = ("direction", "name", "status")
        self.activity = ttk.Treeview(right, columns=columns, show="headings", height=10)
        self.activity.heading("direction", text="")
        self.activity.heading("name", text="File")
        self.activity.heading("status", text="Status")
        self.activity.column("direction", width=34, anchor="center", stretch=False)
        self.activity.column("name", width=165)
        self.activity.column("status", width=115)
        self.activity.pack(fill="both", expand=True)
        ttk.Button(right, text="Open downloads", style="Quiet.TButton", command=self.open_downloads).pack(anchor="e", pady=(10, 0))

        footer = ttk.Label(main, text="FileDrop works on your local network. The receiver must approve every file.", style="Subtitle.TLabel")
        footer.pack(anchor="w", pady=(12, 0))

    def toggle_enabled(self) -> None:
        self.service.set_enabled(self.enabled_var.get())
        self.status_label.configure(text="Ready" if self.enabled_var.get() else "FileDrop is off")

    def save_name(self) -> None:
        self.service.set_name(self.name_var.get())
        self.name_var.set(self.service.name)
        self.status_label.configure(text="Name saved")

    def choose_files(self) -> None:
        selected = filedialog.askopenfilenames(title="Choose files to send")
        self.selected_files = [Path(value) for value in selected]
        if not self.selected_files:
            self.file_label.configure(text="No files selected")
        elif len(self.selected_files) == 1:
            item = self.selected_files[0]
            self.file_label.configure(text=f"{item.name}  ·  {human_size(item.stat().st_size)}")
        else:
            total = sum(path.stat().st_size for path in self.selected_files)
            self.file_label.configure(text=f"{len(self.selected_files)} files  ·  {human_size(total)}")

    def send_files(self) -> None:
        selection = self.devices.curselection()
        if not selection:
            messagebox.showinfo("Choose a device", "Select the device that should receive the files.", parent=self.root)
            return
        if not self.selected_files:
            self.choose_files()
            if not self.selected_files:
                return
        peer_id = self.peer_rows[selection[0]]
        errors: list[str] = []
        for path in self.selected_files:
            try:
                self.service.queue_file(peer_id, path)
            except (OSError, ValueError) as error:
                errors.append(f"{path.name}: {error}")
        if errors:
            messagebox.showerror("Could not send some files", "\n".join(errors), parent=self.root)
        else:
            self.status_label.configure(text="Waiting for approval")
            self.selected_files = []
            self.file_label.configure(text="No files selected")

    def _prompt_incoming(self, transfer: dict) -> None:
        answer = messagebox.askyesno(
            "Incoming FileDrop",
            f"{transfer.get('peerName', 'Another device')} wants to send:\n\n"
            f"{transfer.get('name')}\n{transfer.get('sizeText')}\n\nAccept this file?",
            parent=self.root,
        )
        if answer:
            self.service.accept(transfer["id"])
        else:
            self.service.reject(transfer["id"])

    @staticmethod
    def _status_text(transfer: dict) -> str:
        state = str(transfer.get("state", "")).replace("_", " ").title()
        if transfer.get("state") in {"sending", "receiving"}:
            return f"{state} {transfer.get('progress', 0)}%"
        if transfer.get("state") == "failed" and transfer.get("error"):
            return "Failed"
        return state

    def refresh(self) -> None:
        snapshot = self.service.snapshot()
        selected_id = None
        current = self.devices.curselection()
        if current and current[0] < len(self.peer_rows):
            selected_id = self.peer_rows[current[0]]
        self.devices.delete(0, "end")
        self.peer_rows = []
        for peer in snapshot["peers"]:
            self.peer_rows.append(peer["id"])
            self.devices.insert("end", f"  {peer['name']}  ·  {peer['platform']}")
        if selected_id in self.peer_rows:
            index = self.peer_rows.index(selected_id)
            self.devices.selection_set(index)
        if not self.peer_rows:
            self.devices.insert("end", "  Looking for nearby devices…")

        for row in self.activity.get_children():
            self.activity.delete(row)
        for transfer in snapshot["transfers"][:25]:
            direction = "↓" if transfer.get("direction") == "incoming" else "↑"
            self.activity.insert("", "end", values=(direction, transfer.get("name"), self._status_text(transfer)))
            if transfer.get("direction") == "incoming" and transfer.get("state") == "pending" and transfer["id"] not in self.prompted:
                self.prompted.add(transfer["id"])
                self.root.after(50, lambda item=transfer: self._prompt_incoming(item))
        self.enabled_var.set(snapshot["enabled"])
        self.send_button.state(["!disabled"] if snapshot["enabled"] and bool(snapshot["peers"]) else ["disabled"])
        self.root.after(700, self.refresh)

    def open_downloads(self) -> None:
        path = self.service.downloads_dir
        path.mkdir(parents=True, exist_ok=True)
        try:
            if platform.system() == "Windows":
                os.startfile(str(path))
            elif platform.system() == "Darwin":
                subprocess.Popen(["open", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path)])
        except OSError as error:
            messagebox.showerror("Could not open downloads", str(error), parent=self.root)

    def close(self) -> None:
        self.service.stop()
        self.root.destroy()


def main() -> int:
    root = tk.Tk()
    if platform.system() == "Windows":
        try:
            from ctypes import windll

            windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    FileDropApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
