import { useEffect, useState } from "react";
import { colorSkins } from "../domain/constants";
import { loadColorSkin, loadColorTheme, saveColorSkin, saveColorTheme } from "../domain/storage";
import { ColorSkin, ColorTheme, WorkspaceView } from "../domain/types";

export type WorkspacePageTitle = {
  eyebrow: string;
  title: string;
};

export function workspacePageTitles(activeDraftTitle: string): Record<WorkspaceView, WorkspacePageTitle> {
  return {
    dashboard: { eyebrow: "Operations", title: "Operations dashboard" },
    editor: { eyebrow: "Submission workspace", title: activeDraftTitle || "Untitled submission" },
    saved: { eyebrow: "Content library", title: "Content library" },
    templates: { eyebrow: "Reusable copy library", title: "Saved templates" },
    queue: { eyebrow: "Tumblr automation", title: "Submission queue" },
    runner: { eyebrow: "Tumblr automation", title: "Runner" },
    "queue-settings": { eyebrow: "Tumblr automation", title: "Queues" },
    accounts: { eyebrow: "Tumblr automation", title: "Tumblr accounts" },
    settings: { eyebrow: "Operations", title: "Operational settings" },
    logs: { eyebrow: "Tumblr automation", title: "Runner logs" },
    docs: { eyebrow: "Reference", title: "Testing and change guide" },
  };
}

export function useWorkspaceChrome() {
  const [colorTheme, setColorTheme] = useState<ColorTheme>(() => loadColorTheme());
  const [colorSkin, setColorSkin] = useState<ColorSkin>(() => loadColorSkin());

  useEffect(() => {
    document.documentElement.dataset.theme = colorTheme;
    saveColorTheme(colorTheme);
  }, [colorTheme]);

  useEffect(() => {
    document.documentElement.dataset.skin = colorSkin;
    saveColorSkin(colorSkin);
  }, [colorSkin]);

  function selectColorSkin(nextSkin: ColorSkin) {
    const skinConfig = colorSkins.find((option) => option.value === nextSkin);
    setColorSkin(nextSkin);
    if (skinConfig) {
      setColorTheme(skinConfig.theme);
    }
  }

  function toggleColorTheme() {
    selectColorSkin(colorTheme === "dark" ? "soft-green" : "inkwell-dark");
  }

  return {
    colorSkin,
    colorTheme,
    selectColorSkin,
    toggleColorTheme,
  };
}
