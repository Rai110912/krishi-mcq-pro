import os
import subprocess

scripts = [
    "fix_timer_again.py",
    "fix_timer_mock.py",
    "cleanup_showTimer.py",
    "fix_sr_config.py",
    "fix_sm2_dates.py",
    "fix_sm2_shuffle.py",
    "fix_sm2_mastered.py",
    "fix_wrong_count.py",
    "fix_remaining_wrong.py",
    "fix_sm2_start.py",
    "fix_resume_bug.py",
    "fix_isfinishing.py",
    "fix_save_anti_cheat.py",
    "fix_sm2_engine.py",
    "fix_app_sm2.py",
    "fix_active_due_set.py",
    "fix_sm2_wipe.py",
    "fix_save_data_missing.py",
    "fix_remove_wrong_id.py",
    "fix_sm2_isolation.py",
    "fix_sm2_leak.py",
    "fix_syntax.py",
    "fsrs_upgrade.py",
    "fsrs_retention.py",
    "fsrs_bugfix.py",
    "inject_analytics.py",
    "fsrs_random_bugfix.py",
    "fsrs_analytics_reset_bugfix.py"
]

os.chdir(r"d:\Downloads\test file of Mcq pro")

for script in scripts:
    script_path = os.path.join("scratch", script)
    print(f"Running {script}...")
    result = subprocess.run(["python", script_path], capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error in {script}: {result.stderr}")
    else:
        print(f"Success {script}")

print("Done!")
