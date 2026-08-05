import {
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Image,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
  createIcons,
} from "lucide";

const ICONS = {
  CircleAlert,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  FolderPlus,
  Image,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Search,
  Settings,
  X,
  ZoomIn,
  ZoomOut,
};

export type IconName =
  | "circle-alert"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "chevron-up"
  | "code-2"
  | "copy"
  | "download"
  | "file-plus"
  | "folder-open"
  | "folder-plus"
  | "image"
  | "maximize-2"
  | "panel-left-close"
  | "panel-left-open"
  | "panel-right-close"
  | "panel-right-open"
  | "refresh-cw"
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
