import json

def make_lottie():
    lottie_json = {
        "v": "5.5.2",
        "fr": 60,
        "ip": 0,
        "op": 60,
        "w": 500,
        "h": 500,
        "nm": "Streak Flame Burst",
        "ddd": 0,
        "assets": [],
        "layers": [
            {
                "ddd": 0,
                "ind": 1,
                "ty": 4,
                "nm": "Flame Core",
                "sr": 1,
                "ks": {
                    "o": {"a": 1, "k": [{"i": {"x": [0.833], "y": [0.833]}, "o": {"x": [0.167], "y": [0.167]}, "t": 0, "s": [100]}, {"t": 45, "s": [0]}], "ix": 11},
                    "r": {"a": 0, "k": 0, "ix": 10},
                    "p": {"a": 1, "k": [{"i": {"x": [0.833], "y": [0.833]}, "o": {"x": [0.167], "y": [0.167]}, "t": 0, "s": [250, 250, 0]}, {"t": 50, "s": [250, 150, 0]}], "ix": 2},
                    "a": {"a": 0, "k": [0, 0, 0], "ix": 1},
                    "s": {"a": 1, "k": [{"i": {"x": [0.833], "y": [0.833]}, "o": {"x": [0.167], "y": [0.167]}, "t": 0, "s": [50, 50, 100]}, {"t": 15, "s": [150, 150, 100]}, {"t": 50, "s": [20, 20, 100]}], "ix": 6}
                },
                "ao": 0,
                "shapes": [
                    {
                        "ty": "gr",
                        "it": [
                            {
                                "ty": "el",
                                "d": 1,
                                "p": {"a": 0, "k": [0, 0]},
                                "s": {"a": 0, "k": [100, 100]}
                            },
                            {
                                "ty": "fl",
                                "c": {"a": 0, "k": [1, 0.5, 0.1, 1]}
                            },
                            {
                                "ty": "tr",
                                "p": {"a": 0, "k": [0, 0]},
                                "a": {"a": 0, "k": [0, 0]},
                                "s": {"a": 0, "k": [100, 100]},
                                "r": {"a": 0, "k": 0},
                                "o": {"a": 0, "k": 100}
                            }
                        ],
                        "nm": "Group 1"
                    }
                ],
                "ip": 0,
                "op": 60,
                "st": 0,
                "bm": 0
            }
        ]
    }
    
    with open("assets/lottie/streak.json", "w") as f:
        json.dump(lottie_json, f)
        
    with open("assets/lottie/achievement.json", "w") as f:
        json.dump(lottie_json, f)
        
    print("Valid lottie files written")

make_lottie()
