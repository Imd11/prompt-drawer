use std::path::{Path, PathBuf};

use super::{CandidateInput, ProcessLaunchIdentity};

const WECHAT_BUNDLE_ID: &str = "com.tencent.xinWeChat";
const WECHAT_APP_EX_BUNDLE_ID: &str = "com.tencent.flue.WeChatAppEx";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ProcessScope {
    MainOnly,
    MainAndValidatedBrowserApplications,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ProcessRole {
    MainApplication,
    BrowserApplication,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct TrustedProcess {
    pub pid: u32,
    pub role: ProcessRole,
    pub bundle_id: String,
    pub executable_path: PathBuf,
}

#[derive(Clone, Debug)]
pub(super) struct ProcessSnapshot {
    pub pid: u32,
    pub parent_pid: u32,
    pub bundle_id: String,
    pub executable_path: PathBuf,
    pub launch_identity: ProcessLaunchIdentity,
    pub window_frame: Option<CandidateInput>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ProcessGroupError {
    MainProcessMissing,
    MainProcessReplaced,
    MissingRequiredWindow,
}

pub(super) fn resolve_process_group(
    main_pid: u32,
    main_bundle_id: &str,
    main_launch_identity: ProcessLaunchIdentity,
    captured_window: Option<&CandidateInput>,
    scope: ProcessScope,
    snapshots: &[ProcessSnapshot],
) -> Result<Vec<TrustedProcess>, ProcessGroupError> {
    let main = snapshots
        .iter()
        .find(|process| process.pid == main_pid && process.bundle_id == main_bundle_id)
        .ok_or(ProcessGroupError::MainProcessMissing)?;
    if main.launch_identity != main_launch_identity {
        return Err(ProcessGroupError::MainProcessReplaced);
    }

    let mut trusted = vec![TrustedProcess {
        pid: main.pid,
        role: ProcessRole::MainApplication,
        bundle_id: main.bundle_id.clone(),
        executable_path: main.executable_path.clone(),
    }];
    if scope == ProcessScope::MainOnly {
        return Ok(trusted);
    }

    let captured_window = captured_window.ok_or(ProcessGroupError::MissingRequiredWindow)?;
    let Some(main_bundle_root) = app_bundle_root(&main.executable_path) else {
        return Ok(trusted);
    };
    for candidate in snapshots {
        if candidate.bundle_id != WECHAT_APP_EX_BUNDLE_ID
            || main_bundle_id != WECHAT_BUNDLE_ID
            || !is_descendant_of(candidate.pid, main_pid, snapshots)
            || app_bundle_root(&candidate.executable_path) != Some(main_bundle_root)
            || !candidate
                .window_frame
                .as_ref()
                .is_some_and(|frame| frames_overlap(frame, captured_window))
        {
            continue;
        }
        trusted.push(TrustedProcess {
            pid: candidate.pid,
            role: ProcessRole::BrowserApplication,
            bundle_id: candidate.bundle_id.clone(),
            executable_path: candidate.executable_path.clone(),
        });
    }
    Ok(trusted)
}

fn app_bundle_root(path: &Path) -> Option<&Path> {
    let mut cursor = path;
    loop {
        if cursor
            .extension()
            .is_some_and(|extension| extension == "app")
        {
            return Some(cursor);
        }
        cursor = cursor.parent()?;
    }
}

fn is_descendant_of(pid: u32, ancestor_pid: u32, snapshots: &[ProcessSnapshot]) -> bool {
    let mut current = pid;
    for _ in 0..32 {
        let Some(process) = snapshots.iter().find(|process| process.pid == current) else {
            return false;
        };
        if process.parent_pid == ancestor_pid {
            return true;
        }
        if process.parent_pid == 0 || process.parent_pid == current {
            return false;
        }
        current = process.parent_pid;
    }
    false
}

fn frames_overlap(left: &CandidateInput, right: &CandidateInput) -> bool {
    let width = (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let height = (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);
    width > 0.0 && height > 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(seconds: u64) -> ProcessLaunchIdentity {
        ProcessLaunchIdentity {
            seconds,
            microseconds: 0,
        }
    }

    fn frame(x: f64) -> CandidateInput {
        CandidateInput {
            x,
            y: 0.0,
            width: 800.0,
            height: 600.0,
        }
    }

    fn process(
        pid: u32,
        parent_pid: u32,
        bundle_id: &str,
        path: &str,
        window_frame: Option<CandidateInput>,
    ) -> ProcessSnapshot {
        ProcessSnapshot {
            pid,
            parent_pid,
            bundle_id: bundle_id.to_string(),
            executable_path: PathBuf::from(path),
            launch_identity: launch(pid as u64),
            window_frame,
        }
    }

    #[test]
    fn process_group_keeps_claude_on_its_main_application() {
        let snapshots = vec![
            process(
                10,
                1,
                "com.anthropic.claudefordesktop",
                "/Applications/Claude.app/Contents/MacOS/Claude",
                Some(frame(0.0)),
            ),
            process(
                11,
                10,
                "com.anthropic.claudefordesktop.helper",
                "/Applications/Claude.app/Contents/Frameworks/Claude Helper",
                Some(frame(0.0)),
            ),
        ];
        let group = resolve_process_group(
            10,
            "com.anthropic.claudefordesktop",
            launch(10),
            Some(&frame(0.0)),
            ProcessScope::MainOnly,
            &snapshots,
        )
        .unwrap();

        assert_eq!(group.len(), 1);
        assert_eq!(group[0].pid, 10);
    }

    #[test]
    fn process_group_accepts_only_validated_wechat_app_ex() {
        let snapshots = vec![
            process(
                20,
                1,
                WECHAT_BUNDLE_ID,
                "/Applications/WeChat.app/Contents/MacOS/WeChat",
                Some(frame(0.0)),
            ),
            process(
                21,
                20,
                WECHAT_APP_EX_BUNDLE_ID,
                "/Applications/WeChat.app/Contents/Frameworks/WeChatAppEx",
                Some(frame(10.0)),
            ),
            process(
                22,
                20,
                WECHAT_APP_EX_BUNDLE_ID,
                "/tmp/Fake.app/Contents/MacOS/WeChatAppEx",
                Some(frame(10.0)),
            ),
            process(
                23,
                999,
                WECHAT_APP_EX_BUNDLE_ID,
                "/Applications/WeChat.app/Contents/Frameworks/WeChatAppEx",
                Some(frame(10.0)),
            ),
            process(
                24,
                20,
                WECHAT_APP_EX_BUNDLE_ID,
                "/Applications/WeChat.app/Contents/Frameworks/WeChatAppEx",
                Some(frame(2_000.0)),
            ),
        ];
        let group = resolve_process_group(
            20,
            WECHAT_BUNDLE_ID,
            launch(20),
            Some(&frame(0.0)),
            ProcessScope::MainAndValidatedBrowserApplications,
            &snapshots,
        )
        .unwrap();

        assert_eq!(
            group.iter().map(|process| process.pid).collect::<Vec<_>>(),
            vec![20, 21]
        );
    }

    #[test]
    fn process_group_rejects_pid_reuse_and_missing_required_window() {
        let snapshots = vec![process(
            20,
            1,
            WECHAT_BUNDLE_ID,
            "/Applications/WeChat.app/Contents/MacOS/WeChat",
            Some(frame(0.0)),
        )];
        assert_eq!(
            resolve_process_group(
                20,
                WECHAT_BUNDLE_ID,
                launch(99),
                Some(&frame(0.0)),
                ProcessScope::MainOnly,
                &snapshots,
            ),
            Err(ProcessGroupError::MainProcessReplaced)
        );
        assert_eq!(
            resolve_process_group(
                20,
                WECHAT_BUNDLE_ID,
                launch(20),
                None,
                ProcessScope::MainAndValidatedBrowserApplications,
                &snapshots,
            ),
            Err(ProcessGroupError::MissingRequiredWindow)
        );
    }
}
