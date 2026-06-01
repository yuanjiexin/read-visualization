/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { Settings, Key, RefreshCw, X, TerminalSquare, ClipboardPaste } from "lucide-react";
import {
  DEFAULT_SKILL_INSTALL_COMMAND,
  getStoredApiKey,
  getStoredSkillInstallCommand,
  setStoredApiKey,
  setStoredSkillInstallCommand
} from "../api";

interface SettingsPanelProps {
  onRefresh: () => void;
  isLoading: boolean;
  initiallyOpen?: boolean;
}

export default function SettingsPanel({ onRefresh, isLoading, initiallyOpen = false }: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [installCommand, setInstallCommand] = useState(getStoredSkillInstallCommand());
  const [pasteText, setPasteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const applyPastedConfig = (raw: string) => {
    const text = raw.trim();
    if (!text) return;

    const commandMatch = text.match(/npx\s+skills\s+add\s+Tencent\/WeChatReading\s+-g/i);
    if (commandMatch?.[0]) {
      setInstallCommand(commandMatch[0]);
    }

    const apiKeyMatch = text.match(/(?:Bearer\s+)?(wrk-[A-Za-z0-9_-]+)/i);
    if (apiKeyMatch?.[1]) {
      setApiKey(apiKeyMatch[1]);
    }

    setMessage("已识别安装指令和 API Key，请确认后保存。");
  };

  const handleSave = () => {
    if (!installCommand.trim()) {
      setMessage("请填写 Skill 安装指令。");
      return;
    }
    if (!apiKey.trim()) {
      setMessage("API Key 不能为空。");
      return;
    }

    setStoredSkillInstallCommand(installCommand.trim());
    setStoredApiKey(apiKey.trim());
    setMessage("设置已保存，正在拉取微信读书数据...");
    setTimeout(() => {
      setMessage(null);
      setIsOpen(false);
      onRefresh();
    }, 500);
  };

  return (
    <div className="relative z-[140]" id="settings-panel">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded-md shadow-sm font-sans text-sm transition-all duration-300 cursor-pointer"
        title="数据源设置"
      >
        <Settings className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">数据源设置</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 w-[420px] bg-[#FAF9F6] border border-[#2C2C26]/15 rounded-lg shadow-md p-5 font-sans text-[#2C2C26] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-[#2C2C26]/10 pb-3 mb-4">
            <h3 className="font-sans font-medium text-sm tracking-wide text-[#2C2C26] flex items-center gap-1.5">
              <RefreshCw className="w-4 h-4 text-[#2C2C26]/60" />
              微信读书数据源
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[#2C2C26]/40 hover:text-[#2C2C26] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                <ClipboardPaste className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                快速粘贴
              </label>
              <textarea
                value={pasteText}
                onChange={(e) => {
                  setPasteText(e.target.value);
                  applyPastedConfig(e.target.value);
                }}
                placeholder={`${DEFAULT_SKILL_INSTALL_COMMAND}\n<WEREAD_API_KEY>`}
                className="w-full h-20 resize-none px-3 py-2 bg-white border border-[#2C2C26]/10 rounded text-xs text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                <TerminalSquare className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                Skill 安装指令
              </label>
              <input
                type="text"
                value={installCommand}
                onChange={(e) => setInstallCommand(e.target.value)}
                placeholder={DEFAULT_SKILL_INSTALL_COMMAND}
                className="w-full px-3 py-1.5 bg-white border border-[#2C2C26]/10 rounded text-sm text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                <Key className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                API Key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="<WEREAD_API_KEY>"
                className="w-full px-3 py-1.5 bg-white border border-[#2C2C26]/10 rounded text-sm text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
              />
            </div>

            {message && (
              <div className="p-2.5 bg-white border border-[#2C2C26]/10 rounded text-xs text-[#2C2C26]/80 leading-relaxed">
                {message}
              </div>
            )}

            <button
              onClick={handleSave}
              className="w-full py-2 bg-[#2C2C26] hover:bg-[#2C2C26]/90 active:scale-98 text-white text-xs font-medium tracking-wider rounded border border-[#2C2C26]/20 shadow-xs transition-all duration-200 cursor-pointer"
            >
              保存并同步数据
            </button>

            <p className="text-[10px] text-[#2C2C26]/50 leading-relaxed font-sans text-center mt-2 border-t border-[#2C2C26]/5 pt-2">
              只需要这两项。网关地址与接口版本由应用内部处理。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
