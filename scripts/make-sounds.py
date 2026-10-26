#!/usr/bin/env python3
"""Generate the bundled alert WAVs (48 kHz / 16-bit / stereo, stdlib only).

音色思路：用带指数衰减的泛音叠加模拟“钟 / 木琴”，而不是正弦波的滴滴声；
左右声道错开十几毫秒，再加两级低幅回声，听起来有空间感、不刺耳。

Run:  python3 make-sounds.py [output-dir]
"""

from __future__ import annotations

import math
import struct
import sys
import wave
from pathlib import Path

SR = 48_000


def partial(freq: float, dur: float, amp: float, decay: float, attack: float = 0.006) -> list[float]:
    """单个泛音：短促的软起音 + 指数衰减。"""
    n = int(SR * dur)
    out: list[float] = []
    for i in range(n):
        t = i / SR
        env = min(1.0, t / attack) * math.exp(-t / decay)
        out.append(amp * env * math.sin(2 * math.pi * freq * t))
    return out


def bell(freq: float, dur: float = 1.3, amp: float = 1.0, decay: float = 0.34) -> list[float]:
    """钟体：基频 + 略带非谐的泛音，高次泛音衰减更快。"""
    parts = [(1.0, 1.00, 1.00), (2.00, 0.34, 0.75), (2.98, 0.13, 0.55), (4.20, 0.05, 0.40)]
    out = [0.0] * int(SR * dur)
    for ratio, level, damp in parts:
        layer = partial(freq * ratio, dur, amp * level, decay * damp)
        for i, sample in enumerate(layer):
            out[i] += sample
    return out


def wood(freq: float, dur: float = 0.6, amp: float = 1.0) -> list[float]:
    """木质打击音：奇次泛音为主，衰减极快，清晰但不吵。"""
    out = [0.0] * int(SR * dur)
    for ratio, level in ((1.0, 1.0), (3.0, 0.16), (5.0, 0.05)):
        layer = partial(freq * ratio, dur, amp * level, 0.11 / (1.0 + 0.25 * (ratio - 1)))
        for i, sample in enumerate(layer):
            out[i] += sample
    return out


def soft_low(freq: float, dur: float = 0.9, amp: float = 1.0) -> list[float]:
    """低音：基频加一点二次泛音，20ms 起音，避免“哔”的锐利感。"""
    out = [0.0] * int(SR * dur)
    for ratio, level, decay in ((1.0, 1.0, 0.30), (2.0, 0.10, 0.18)):
        layer = partial(freq * ratio, dur, amp * level, decay, attack=0.02)
        for i, sample in enumerate(layer):
            out[i] += layer[i]
    return out


def place(at: float, *tracks: list[float]) -> list[float]:
    """把若干音轨混到时间轴 at 秒处。"""
    start = int(SR * at)
    length = start + max(len(t) for t in tracks)
    out = [0.0] * length
    for track in tracks:
        for i, sample in enumerate(track):
            out[start + i] += sample
    return out


def echo(track: list[float]) -> list[float]:
    """两级低幅回声，制造一点房间感。"""
    out = list(track)
    for delay, gain in ((0.075, 0.20), (0.140, 0.09)):
        offset = int(SR * delay)
        if len(out) < len(track) + offset:
            out.extend([0.0] * (len(track) + offset - len(out)))
        for i, sample in enumerate(track):
            out[i + offset] += sample * gain
    return out


def stereo(track: list[float], width_ms: float = 11.0) -> list[tuple[float, float]]:
    """左声道原样、右声道延后一点点，得到轻微的开阔感。"""
    offset = int(SR * width_ms / 1000.0)
    frames: list[tuple[float, float]] = []
    for i in range(len(track) + offset):
        left = track[i] if i < len(track) else 0.0
        right = track[i - offset] if i >= offset else 0.0
        frames.append((left, right))
    return frames


def mix(*tracks: list[float]) -> list[float]:
    """把多条时间轴对齐的轨道相加（短的补零）。"""
    length = max(len(t) for t in tracks)
    out = [0.0] * length
    for track in tracks:
        for i, sample in enumerate(track):
            out[i] += sample
    return out


def write(path: Path, frames: list[tuple[float, float]], peak_target: float = 0.50) -> None:
    peak = max((max(abs(l), abs(r)) for l, r in frames), default=0.0)
    gain = peak_target / peak if peak > peak_target else 1.0
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        payload = bytearray()
        for left, right in frames:
            for value in (left * gain, right * gain):
                payload += struct.pack("<h", int(max(-1.0, min(1.0, value)) * 32767))
        handle.writeframes(bytes(payload))


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "sounds"
    out.mkdir(parents=True, exist_ok=True)

    # 完成：两个钟音上行（A5 → E6），尾音留一点。
    done = mix(place(0.00, bell(880.00, 1.10, 0.9)), place(0.26, bell(1318.51, 1.35, 1.0)))

    # 出错：两个低音下行（A3 → E3），音色偏木、不尖叫。
    error = mix(place(0.00, soft_low(220.00, 0.75, 0.9)), place(0.22, soft_low(164.81, 1.05, 1.0)))

    # 待审批：三记木鱼式上行（C6 → E6 → G6），清晰但不是警报。
    approval = mix(
        place(0.00, wood(1046.50, 0.55, 0.9)),
        place(0.13, wood(1318.51, 0.60, 1.0)),
        place(0.26, wood(1567.98, 0.62, 1.0)),
    )

    # 提问：两个音上行五度（D5 → A5），像一句上扬的“嗯？”，与审批的三连 pip 区分。
    question = mix(place(0.00, wood(587.33, 0.55, 0.85)), place(0.16, wood(880.00, 1.10, 0.95)))

    # 触顶：两声同样的钟音，中性，区别于“完成”。
    max_tokens = mix(place(0.00, bell(783.99, 0.80, 0.9)), place(0.28, bell(783.99, 0.80, 0.8)))

    for stem, track in (
        ("done", done),
        ("question", question),
        ("error", error),
        ("approval", approval),
        ("max-tokens", max_tokens),
    ):
        write(out / f"{stem}.wav", stereo(echo(track)))
        path = out / f"{stem}.wav"
        print(f"{path}  {path.stat().st_size} bytes  {len(track) / SR:.2f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
