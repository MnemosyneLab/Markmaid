import {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Image,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
  createIcons,
} from "lucide";

const ICONS = {
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FolderOpen,
  Image,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
};

export type IconName =
  | "chevron-down"
  | "chevron-up"
  | "code-2"
  | "copy"
  | "download"
  | "folder-open"
  | "image"
  | "maximize-2"
  | "panel-left-close"
  | "panel-left-open"
  | "panel-right-close"
  | "panel-right-open"
  | "search"
  | "settings"
  | "x"
  | "zoom-in"
  | "zoom-out";

export function icon(name: IconName): string {
  return `<i data-lucide="${name}"></i>`;
}

export function renderIcons(root: Element | DocumentFragment): void {
  createIcons({
    root,
    icons: ICONS,
    attrs: {
      "aria-hidden": "true",
      focusable: "false",
    },
  });
}
