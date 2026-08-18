import json

lottie_json = {
  "v": "5.5.2", "fr": 60, "ip": 0, "op": 60, "w": 500, "h": 500, "nm": "Red Box", "ddd": 0, "assets": [],
  "layers": [
    {
      "ddd": 0, "ind": 1, "ty": 1, "nm": "Solid", "sr": 1,
      "ks": {
        "o": {"a": 0, "k": 100},
        "r": {"a": 0, "k": 0},
        "p": {"a": 0, "k": [250, 250, 0]},
        "a": {"a": 0, "k": [250, 250, 0]},
        "s": {"a": 0, "k": [100, 100, 100]}
      },
      "ao": 0,
      "sw": 500, "sh": 500, "sc": "#ff0000",
      "ip": 0, "op": 60, "st": 0, "bm": 0
    }
  ]
}

with open("assets/lottie/streak.json", "w") as f:
    json.dump(lottie_json, f)
