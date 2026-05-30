/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { BrainCircuit, CheckCircle2, ClipboardPaste, Key, Link, RefreshCw, X } from "lucide-react";
import {
  DEFAULT_ANALYSIS_API_ENDPOINT,
  DEFAULT_ANALYSIS_MODEL,
  getStoredAnalysisApiConfig,
  normalizeAnalysisEndpoint,
  parseAnalysisCurl,
  setStoredAnalysisApiConfig,
  testAnalysisApiConfig,
  AnalysisApiConfig
} from "../api";

interface AnalysisSettingsPanelProps {
  onSaved: (config: AnalysisApiConfig, connected: boolean) => void;
}

export default function AnalysisSettingsPanel({ onSaved }: AnalysisSettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState<AnalysisApiConfig>(getStoredAnalysisApiConfig());
  const [pasteText, setPasteText] = useState("");
  const [testing, setTesting] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const updateConfig = (patch: Partial<AnalysisApiConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
    setConnectionOk(false);
  };

  const applyPastedConfig = (raw: string) => {
    setPasteText(raw);
    const parsed = parseAnalysisCurl(raw);
    if (Object.keys(parsed).length > 0) {
      updateConfig(parsed);
      setMessage(parsed.apiKey ? "已识别接口地址、Key 和模型名，请确认后保存。" : "已识别接口地址或模型名，请补充真实 API Key。");
    }
  };

  const handleSave = () => {
    if (!config.endpoint.trim() || !config.model.trim()) {
      setMessage("请填写接口地址和模型名。");
      return;
    }
    if (!config.apiKey.trim()) {
      setMessage("请填写 API Key。");
      return;
    }

    const cleanConfig = {
      endpoint: normalizeAnalysisEndpoint(config.endpoint.trim(), config.model.trim()),
      apiKey: config.apiKey.trim(),
      model: config.model.trim()
    };
    setStoredAnalysisApiConfig(cleanConfig);
    setMessage(connectionOk ? "分析模型设置已保存，连接状态已保持。" : "分析模型设置已保存，请测试连接或在画布上重试分析。");
    onSaved(cleanConfig, connectionOk);
    setTimeout(() => setIsOpen(false), 400);
  };

  const handleTest = async () => {
    const cleanConfig = {
      endpoint: normalizeAnalysisEndpoint(config.endpoint.trim(), config.model.trim()),
      apiKey: config.apiKey.trim(),
      model: config.model.trim()
    };
    if (!cleanConfig.endpoint || !cleanConfig.apiKey || !cleanConfig.model) {
      setMessage("请先补全接口地址、API Key 和模型名。");
      return;
    }

    try {
      setTesting(true);
      setMessage("正在测试分析模型连接...");
      const result = await testAnalysisApiConfig(cleanConfig);
      setStoredAnalysisApiConfig(cleanConfig);
      setConnectionOk(!!result.ok);
      setMessage("连接成功，后续年度阅读人格会使用这个模型生成。");
      onSaved(cleanConfig, !!result.ok);
    } catch (error: any) {
      setStoredAnalysisApiConfig(cleanConfig);
      setConnectionOk(false);
      setMessage(error?.message || "连接失败，请检查 Key、接口地址或模型名。");
      onSaved(cleanConfig, false);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="relative z-[99]" id="analysis-settings-panel">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-[#2C2C26]/5 text-[#2C2C26] border border-[#2C2C26]/10 rounded-md shadow-sm font-sans text-sm transition-all duration-300 cursor-pointer"
        title="分析模型设置"
      >
        <BrainCircuit className="w-4 h-4 text-[#2C2C26]/75" />
        <span className="hidden sm:inline">分析模型</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 top-12 w-[460px] bg-[#FAF9F6] border border-[#2C2C26]/15 rounded-lg shadow-md p-5 font-sans text-[#2C2C26] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between border-b border-[#2C2C26]/10 pb-3 mb-4">
            <h3 className="font-sans font-medium text-sm tracking-wide flex items-center gap-1.5">
              <BrainCircuit className="w-4 h-4 text-[#2C2C26]/60" />
              年度阅读人格分析模型
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
                粘贴 API 调用示例
              </label>
              <textarea
                value={pasteText}
                onChange={(event) => applyPastedConfig(event.target.value)}
                placeholder={`curl ${DEFAULT_ANALYSIS_API_ENDPOINT}\n-H "Authorization: Bearer <API_KEY>"\n-d '{"model":"${DEFAULT_ANALYSIS_MODEL}"}'\n\n也可粘贴 OpenAI / Claude / DeepSeek / Kimi 示例`}
                className="w-full h-24 resize-none px-3 py-2 bg-white border border-[#2C2C26]/10 rounded text-xs text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                <Link className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                接口地址
              </label>
              <input
                type="text"
                value={config.endpoint}
                onChange={(event) => updateConfig({ endpoint: event.target.value })}
                placeholder={DEFAULT_ANALYSIS_API_ENDPOINT}
                className="w-full px-3 py-1.5 bg-white border border-[#2C2C26]/10 rounded text-sm text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                  <Key className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                  API Key
                </label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(event) => updateConfig({ apiKey: event.target.value })}
                  placeholder="<API_KEY>"
                  className="w-full px-3 py-1.5 bg-white border border-[#2C2C26]/10 rounded text-sm text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono font-medium text-[#2C2C26]/75 flex items-center gap-1">
                  <BrainCircuit className="w-3.5 h-3.5 text-[#2C2C26]/40" />
                  模型名
                </label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(event) => updateConfig({ model: event.target.value })}
                  placeholder={DEFAULT_ANALYSIS_MODEL}
                  className="w-full px-3 py-1.5 bg-white border border-[#2C2C26]/10 rounded text-sm text-[#2C2C26] font-mono focus:outline-none focus:ring-1 focus:ring-[#2C2C26] focus:border-[#2C2C26] placeholder-[#2C2C26]/30"
                />
              </div>
            </div>

            {message && (
              <div className="p-2.5 bg-white border border-[#2C2C26]/10 rounded text-xs text-[#2C2C26]/80 leading-relaxed">
                {message}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handleTest}
                disabled={testing}
                className="py-2 bg-white hover:bg-[#2C2C26]/5 disabled:opacity-50 text-[#2C2C26] text-xs font-medium tracking-wider rounded border border-[#2C2C26]/15 shadow-xs transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
              >
                {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                测试连接
              </button>
              <button
                onClick={handleSave}
                className="py-2 bg-[#2C2C26] hover:bg-[#2C2C26]/90 active:scale-98 text-white text-xs font-medium tracking-wider rounded border border-[#2C2C26]/20 shadow-xs transition-all duration-200 cursor-pointer"
              >
                {connectionOk ? "保存已验证配置" : "保存配置"}
              </button>
            </div>

            <p className="text-[10px] text-[#2C2C26]/50 leading-relaxed font-sans text-center mt-2 border-t border-[#2C2C26]/5 pt-2">
              年度阅读人格的提示词在 reading-personality-prompt.md，修改后重新分析即可生效。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
