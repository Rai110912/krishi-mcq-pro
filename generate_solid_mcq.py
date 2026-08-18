import json

def build_solid_layer(ind, name, color, w, h, p_start, p_end, r_val, scale_start, scale_end, duration=30):
    return {
        "ddd": 0, "ind": ind, "ty": 1, "nm": name, "sr": 1,
        "ks": {
            "o": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 5, "s": [100]}, {"t": duration-5, "s": [100]}, {"t": duration, "s": [0]}]},
            "r": {"a": 0, "k": r_val},
            "p": {"a": 1, "k": [{"i":{"x":[0.2],"y":[1]},"o":{"x":[0.2],"y":[0]},"t": 0, "s": p_start}, {"t": 10, "s": p_end}]},
            "a": {"a": 0, "k": [w/2, h/2, 0]},
            "s": {"a": 1, "k": [{"i":{"x":[0.2],"y":[1]},"o":{"x":[0.2],"y":[0]},"t": 0, "s": scale_start}, {"t": 10, "s": scale_end}]}
        },
        "ao": 0, "sw": w, "sh": h, "sc": color,
        "ip": 0, "op": duration, "st": 0, "bm": 0
    }

# Correct Animation (Checkmark)
# Center is 250, 250.
# Short leg: w=20, h=60, rot= -45.
# Long leg: w=20, h=120, rot= 45.
correct_json = {
    "v": "5.5.2", "fr": 60, "ip": 0, "op": 35, "w": 500, "h": 500, "nm": "Correct Check", "ddd": 0, "assets": [],
    "layers": [
        build_solid_layer(1, "Long Leg", "#10b981", 20, 120, [250, 250, 0], [270, 230, 0], 45, [0,0,100], [100,100,100], 35),
        build_solid_layer(2, "Short Leg", "#10b981", 20, 60, [250, 250, 0], [230, 260, 0], -45, [0,0,100], [100,100,100], 35)
    ]
}

# Wrong Animation (Cross and Shake)
wrong_json = {
    "v": "5.5.2", "fr": 60, "ip": 0, "op": 35, "w": 500, "h": 500, "nm": "Wrong Cross", "ddd": 0, "assets": [],
    "layers": [
        {
            "ddd": 0, "ind": 1, "ty": 1, "nm": "Line 1", "sr": 1,
            "ks": {
                "o": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 4, "s": [100]}, {"t": 30, "s": [100]}, {"t": 35, "s": [0]}]},
                "r": {"a": 0, "k": 45},
                "p": {"a": 1, "k": [
                    {"t": 0, "s": [250, 250, 0]},
                    {"t": 5, "s": [230, 250, 0]},
                    {"t": 10, "s": [270, 250, 0]},
                    {"t": 15, "s": [240, 250, 0]},
                    {"t": 20, "s": [250, 250, 0]}
                ]},
                "a": {"a": 0, "k": [10, 50, 0]},
                "s": {"a": 1, "k": [{"i":{"x":[0.2],"y":[1]},"o":{"x":[0.2],"y":[0]},"t": 0, "s": [0,0,100]}, {"t": 6, "s": [100,100,100]}]}
            },
            "ao": 0, "sw": 20, "sh": 100, "sc": "#ef4444",
            "ip": 0, "op": 35, "st": 0, "bm": 0
        },
        {
            "ddd": 0, "ind": 2, "ty": 1, "nm": "Line 2", "sr": 1,
            "ks": {
                "o": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 4, "s": [100]}, {"t": 30, "s": [100]}, {"t": 35, "s": [0]}]},
                "r": {"a": 0, "k": -45},
                "p": {"a": 1, "k": [
                    {"t": 0, "s": [250, 250, 0]},
                    {"t": 5, "s": [230, 250, 0]},
                    {"t": 10, "s": [270, 250, 0]},
                    {"t": 15, "s": [240, 250, 0]},
                    {"t": 20, "s": [250, 250, 0]}
                ]},
                "a": {"a": 0, "k": [10, 50, 0]},
                "s": {"a": 1, "k": [{"i":{"x":[0.2],"y":[1]},"o":{"x":[0.2],"y":[0]},"t": 0, "s": [0,0,100]}, {"t": 6, "s": [100,100,100]}]}
            },
            "ao": 0, "sw": 20, "sh": 100, "sc": "#ef4444",
            "ip": 0, "op": 35, "st": 0, "bm": 0
        }
    ]
}

with open("assets/lottie/correct.json", "w") as f:
    json.dump(correct_json, f)

with open("assets/lottie/wrong.json", "w") as f:
    json.dump(wrong_json, f)

with open("assets/lottie/achievement.json", "w") as f:
    json.dump(correct_json, f)

with open("assets/lottie/streak.json", "w") as f:
    json.dump(correct_json, f)

print("Generated rock-solid Lottie primitives.")
