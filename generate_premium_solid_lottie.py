import json

def build_solid_layer(ind, name, color, w, h, p_start, p_end, r_val, scale_start, scale_end, duration=45, bounce=False):
    # Bounce easing: overshoot
    easing = {"i":{"x":[0.25],"y":[1.5]}, "o":{"x":[0.25],"y":[0]}} if bounce else {"i":{"x":[0.25],"y":[1]}, "o":{"x":[0.25],"y":[0]}}
    
    return {
        "ddd": 0, "ind": ind, "ty": 1, "nm": name, "sr": 1,
        "ks": {
            "o": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 3, "s": [100]}, {"t": duration-5, "s": [100]}, {"t": duration, "s": [0]}]},
            "r": {"a": 0, "k": r_val},
            "p": {"a": 1, "k": [
                {"i":easing["i"], "o":easing["o"], "t": 0, "s": p_start},
                {"t": int(duration*0.4), "s": p_end}
            ]},
            "a": {"a": 0, "k": [w/2, h/2, 0]},
            "s": {"a": 1, "k": [
                {"i":easing["i"], "o":easing["o"], "t": 0, "s": scale_start},
                {"t": int(duration*0.4), "s": scale_end}
            ]}
        },
        "ao": 0, "sw": w, "sh": h, "sc": color,
        "ip": 0, "op": duration, "st": 0, "bm": 0
    }

def build_shake_layer(ind, name, color, w, h, r_val, duration=35):
    return {
        "ddd": 0, "ind": ind, "ty": 1, "nm": name, "sr": 1,
        "ks": {
            "o": {"a": 1, "k": [{"t": 0, "s": [0]}, {"t": 3, "s": [100]}, {"t": duration-5, "s": [100]}, {"t": duration, "s": [0]}]},
            "r": {"a": 0, "k": r_val},
            "p": {"a": 1, "k": [
                {"t": 0, "s": [250, 250, 0]},
                {"t": 4, "s": [235, 250, 0]},
                {"t": 8, "s": [265, 250, 0]},
                {"t": 12, "s": [242, 250, 0]},
                {"t": 16, "s": [255, 250, 0]},
                {"t": 20, "s": [250, 250, 0]}
            ]},
            "a": {"a": 0, "k": [w/2, h/2, 0]},
            "s": {"a": 1, "k": [
                {"i":{"x":[0.25],"y":[1.2]},"o":{"x":[0.25],"y":[0]},"t": 0, "s": [0,0,100]},
                {"t": 10, "s": [100,100,100]}
            ]}
        },
        "ao": 0, "sw": w, "sh": h, "sc": color,
        "ip": 0, "op": duration, "st": 0, "bm": 0
    }

# 45 frames @ 60fps = 750ms
correct_json = {
    "v": "5.5.2", "fr": 60, "ip": 0, "op": 45, "w": 500, "h": 500, "nm": "Premium Check", "ddd": 0, "assets": [],
    "layers": [
        build_solid_layer(1, "Long Leg", "#10b981", 24, 130, [250, 250, 0], [270, 230, 0], 45, [0,0,100], [100,100,100], 45, True),
        build_solid_layer(2, "Short Leg", "#10b981", 24, 65, [250, 250, 0], [230, 260, 0], -45, [0,0,100], [100,100,100], 45, True)
    ]
}

# 35 frames @ 60fps = ~580ms
wrong_json = {
    "v": "5.5.2", "fr": 60, "ip": 0, "op": 35, "w": 500, "h": 500, "nm": "Premium Cross", "ddd": 0, "assets": [],
    "layers": [
        build_shake_layer(1, "Line 1", "#ef4444", 24, 120, 45, 35),
        build_shake_layer(2, "Line 2", "#ef4444", 24, 120, -45, 35)
    ]
}

with open("assets/lottie/correct.json", "w") as f:
    json.dump(correct_json, f)

with open("assets/lottie/wrong.json", "w") as f:
    json.dump(wrong_json, f)

print("Generated premium solid Lottie files.")
