"""Private JSONL worker for reference-based COMET-MBR scoring."""

from __future__ import annotations

import contextlib
import gc
import json
import os
import sys
from pathlib import Path
from typing import Any


MODEL_ID = os.environ.get("FTRANSLATE_COMET_MBR_MODEL_ID", "Unbabel/wmt22-comet-da")
MODEL_REVISION = os.environ.get(
    "FTRANSLATE_COMET_MBR_MODEL_REVISION",
    "2760a223ac957f30acfb18c8aa649b01cf1d75f2",
)
MODEL_PATH = Path(os.environ.get("FTRANSLATE_COMET_MBR_MODEL", ""))

_model: Any = None
_torch: Any = None


def _import_runtime() -> tuple[Any, Any]:
    global _torch
    with contextlib.redirect_stdout(sys.stderr):
        import torch  # pylint: disable=import-outside-toplevel
        from comet import load_from_checkpoint  # pylint: disable=import-outside-toplevel
    _torch = torch
    return torch, load_from_checkpoint


def _device_name(torch: Any) -> str:
    return "cuda" if bool(torch.cuda.is_available()) else "cpu"


def _probe() -> dict[str, Any]:
    torch, _ = _import_runtime()
    return {
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "modelPath": str(MODEL_PATH),
        "modelExists": MODEL_PATH.is_file(),
        "device": _device_name(torch),
    }


def _load_model() -> tuple[Any, Any]:
    global _model
    torch, load_from_checkpoint = _import_runtime()
    if not MODEL_PATH.is_file():
        raise FileNotFoundError("Pinned COMET checkpoint is missing")
    if _model is None:
        with contextlib.redirect_stdout(sys.stderr):
            _model = load_from_checkpoint(str(MODEL_PATH))
    return torch, _model


def _as_score_list(prediction: Any) -> list[float]:
    scores = getattr(prediction, "scores", None)
    if scores is None and isinstance(prediction, (tuple, list)) and prediction:
        scores = prediction[0]
    if hasattr(scores, "detach"):
        scores = scores.detach().cpu().tolist()
    if scores is None:
        raise RuntimeError("COMET prediction did not contain scores")
    return [float(value) for value in scores]


def _score(pairs: list[dict[str, Any]]) -> dict[str, Any]:
    torch, model = _load_model()
    rows = [
        {
            "src": str(pair.get("source", "")),
            "mt": str(pair.get("translation", "")),
            "ref": str(pair.get("reference", "")),
        }
        for pair in pairs
    ]
    with contextlib.redirect_stdout(sys.stderr):
        prediction = model.predict(
            rows,
            batch_size=1,
            gpus=1 if torch.cuda.is_available() else 0,
            progress_bar=False,
        )
    return {"scores": _as_score_list(prediction), "device": _device_name(torch)}


def _unload() -> dict[str, bool]:
    global _model
    _model = None
    gc.collect()
    if _torch is not None and _torch.cuda.is_available():
        _torch.cuda.empty_cache()
    return {"unloaded": True}


def _reply(request_id: Any, *, result: Any = None, error: str | None = None) -> None:
    payload = {
        "id": request_id,
        "ok": error is None,
        "result": result if error is None else None,
        "error": error,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _handle(payload: dict[str, Any]) -> tuple[Any, bool]:
    action = payload.get("action")
    if action == "probe":
        return _probe(), False
    if action == "score":
        pairs = payload.get("pairs")
        if not isinstance(pairs, list):
            raise ValueError("Score request requires a pairs array")
        return _score(pairs), False
    if action == "unload":
        return _unload(), False
    if action == "shutdown":
        return _unload(), True
    raise ValueError("Unknown COMET worker action")


def _run_worker() -> int:
    for line in sys.stdin:
        line = line.lstrip("\ufeff")
        if not line.strip():
            continue
        request_id: Any = None
        try:
            payload = json.loads(line)
            request_id = payload.get("id")
            result, should_stop = _handle(payload)
            _reply(request_id, result=result)
            if should_stop:
                return 0
        except Exception as exc:  # Deliberately exclude source text from diagnostics.
            error_name = type(exc).__name__
            sys.stderr.write(f"COMET worker error: {error_name}\n")
            sys.stderr.flush()
            _reply(request_id, error=f"COMET worker failed: {error_name}")
    return 0


def _run_probe_once() -> int:
    try:
        sys.stdout.write(json.dumps(_probe(), ensure_ascii=False) + "\n")
        return 0
    except Exception as exc:
        sys.stderr.write(f"COMET probe failed: {type(exc).__name__}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(_run_probe_once() if "--probe" in sys.argv[1:] else _run_worker())
