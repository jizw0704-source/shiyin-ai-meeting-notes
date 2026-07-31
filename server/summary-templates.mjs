export const DEFAULT_SUMMARY_TEMPLATE = "meeting-minutes";
export const DEFAULT_REPORT_STYLE = "detailed";
export const SUMMARY_TEMPLATE_VERSION = 1;

export const SUMMARY_TEMPLATES = Object.freeze({
  "meeting-minutes": {
    name: "会议纪要",
    prompt: `当前内容模板：会议纪要。
重点还原会议背景、议题推进、明确决策、风险分歧和可执行行动项。overviewCards应构成会议全景地图，detailedTopics按议题组织，chapters按会议推进顺序组织。`,
  },
  "daily-log": {
    name: "日常记录",
    prompt: `当前内容模板：日常记录。
按时间和话题自然整理当天发生的事情、交流要点、灵感、提醒与后续安排。减少正式会议腔；只有明确达成的结论才放入decisions，零散提醒可转为actionItems。`,
  },
  "project-sync": {
    name: "项目周会",
    prompt: `当前内容模板：项目周会。
优先提取项目进度、已完成里程碑、当前阻塞、跨团队依赖、负责人、时间节点和下一步计划。overviewCards应覆盖进展、问题、协作和计划；actionItems必须尽量保留责任人和截止时间。`,
  },
  brainstorm: {
    name: "头脑风暴",
    prompt: `当前内容模板：头脑风暴。
按想法簇归纳候选方向、优缺点、关键假设、争议与可验证实验，保留不同观点之间的关系。只有会议明确拍板的选项才放入decisions，尚未收敛的想法放入detailedTopics或risks。`,
  },
});

export function normalizeSummaryTemplateId(value) {
  return Object.hasOwn(SUMMARY_TEMPLATES, value) ? value : DEFAULT_SUMMARY_TEMPLATE;
}

export function normalizeReportStyle(value) {
  return value === "visual" ? "visual" : DEFAULT_REPORT_STYLE;
}

export function summaryTemplatePrompt(value) {
  return SUMMARY_TEMPLATES[normalizeSummaryTemplateId(value)].prompt;
}
