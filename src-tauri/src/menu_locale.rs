use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize, Type)]
pub enum NativeUiLocale {
    #[default]
    #[serde(rename = "en")]
    En,
    #[serde(rename = "zh-Hans")]
    ZhHans,
}

impl NativeUiLocale {
    #[allow(dead_code)]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "en" => Some(Self::En),
            "zh-Hans" => Some(Self::ZhHans),
            _ => None,
        }
    }
}

pub struct MenuLabels {
    pub settings: &'static str,
    pub open: &'static str,
    pub quick_open: &'static str,
    pub command_palette: &'static str,
    pub focus_mode: &'static str,
    pub export: &'static str,
    pub close_tab: &'static str,
    pub reopen_closed_tab: &'static str,
    pub reload: &'static str,
    pub next_tab: &'static str,
    pub previous_tab: &'static str,
    pub navigate_back: &'static str,
    pub navigate_forward: &'static str,
    pub open_recent: &'static str,
    pub no_recent_documents: &'static str,
    pub clear_menu: &'static str,
    pub file: &'static str,
    pub view: &'static str,
    pub edit: &'static str,
    pub window: &'static str,
}

pub fn labels(locale: NativeUiLocale) -> MenuLabels {
    match locale {
        NativeUiLocale::En => MenuLabels {
            settings: "Settings...",
            open: "Open...",
            quick_open: "Quick Open...",
            command_palette: "Command Palette...",
            focus_mode: "Toggle Focus Mode",
            export: "Export Document...",
            close_tab: "Close Tab",
            reopen_closed_tab: "Reopen Closed Tab",
            reload: "Reload Document",
            next_tab: "Next Tab",
            previous_tab: "Previous Tab",
            navigate_back: "Back",
            navigate_forward: "Forward",
            open_recent: "Open Recent",
            no_recent_documents: "No Recent Documents",
            clear_menu: "Clear Menu",
            file: "File",
            view: "View",
            edit: "Edit",
            window: "Window",
        },
        NativeUiLocale::ZhHans => MenuLabels {
            settings: "设置...",
            open: "打开...",
            quick_open: "快速打开...",
            command_palette: "命令面板...",
            focus_mode: "切换专注模式",
            export: "导出文档...",
            close_tab: "关闭标签页",
            reopen_closed_tab: "重新打开关闭的标签页",
            reload: "重新加载文档",
            next_tab: "下一个标签页",
            previous_tab: "上一个标签页",
            navigate_back: "后退",
            navigate_forward: "前进",
            open_recent: "打开最近使用的",
            no_recent_documents: "没有最近文档",
            clear_menu: "清除菜单",
            file: "文件",
            view: "显示",
            edit: "编辑",
            window: "窗口",
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_locales_only() {
        assert_eq!(NativeUiLocale::parse("en"), Some(NativeUiLocale::En));
        assert_eq!(
            NativeUiLocale::parse("zh-Hans"),
            Some(NativeUiLocale::ZhHans)
        );
        assert_eq!(NativeUiLocale::parse("zh-Hant"), None);
        assert_eq!(NativeUiLocale::parse("zh-TW"), None);
    }

    #[test]
    fn chinese_labels_do_not_replace_english_ids() {
        let english = labels(NativeUiLocale::En);
        let chinese = labels(NativeUiLocale::ZhHans);
        assert_eq!(english.settings, "Settings...");
        assert_eq!(chinese.settings, "设置...");
        assert_ne!(english.file, chinese.file);
        assert_ne!(english.edit, chinese.edit);
        assert_ne!(english.window, chinese.window);
    }
}
