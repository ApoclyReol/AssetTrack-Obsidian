import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { Notice } from "obsidian";
import type { RuleWorkspace, RuleWorkspaceAnalytics } from "../../types/rules";
import type { ConfigurationEditorPort } from "../../services/ports";
import { messageFor } from "../editorPrimitives";
import type { ConfigurationDirtyFlags } from "./useConfigurationSession";

interface RuleAnalyticsOptions {
  api: ConfigurationEditorPort;
  hostWindow: Window;
  setWorkspace: Dispatch<SetStateAction<RuleWorkspace | null>>;
  dirtyFlagsRef: MutableRefObject<ConfigurationDirtyFlags>;
  initialAnalyticsReady: boolean;
  onError: (message: string) => void;
}

export interface RuleAnalyticsState {
  analyticsReady: boolean;
  historyPanelKey: number;
  setAnalyticsReady: Dispatch<SetStateAction<boolean>>;
  setHistoryPanelKey: Dispatch<SetStateAction<number>>;
  applyAnalytics: (analytics: RuleWorkspaceAnalytics) => void;
  loadAnalytics: () => Promise<void>;
  scheduleAnalyticsLoad: () => void;
}

export function useRuleAnalytics({
  api,
  hostWindow,
  setWorkspace,
  dirtyFlagsRef,
  initialAnalyticsReady,
  onError
}: RuleAnalyticsOptions): RuleAnalyticsState {
  const [analyticsReady, setAnalyticsReady] = useState(initialAnalyticsReady);
  const [historyPanelKey, setHistoryPanelKey] = useState(0);
  const analyticsTimer = useRef<number | null>(null);
  const applyAnalytics = useCallback((analytics: RuleWorkspaceAnalytics) => {
    setWorkspace((current) => {
      if (!current) return current;
      if (!dirtyFlagsRef.current.category && !dirtyFlagsRef.current.rule) {
        return {
          ...current,
          categories_revision: analytics.categories_revision,
          rules_revision: analytics.rules_revision,
          scope: analytics.scope ?? null,
          categories: analytics.categories,
          rules: analytics.rules,
          recommendations: analytics.recommendations,
          historical_products: analytics.historical_products,
          rule_conflicts: analytics.rule_conflicts,
          summary: analytics.summary
        };
      }
      const remoteCategories = new Map(analytics.categories.map((category) => [category.category_key, category]));
      const remoteRules = new Map(analytics.rules.map((rule) => [Number(rule.id ?? 0), rule]));
      return {
        ...current,
        scope: analytics.scope ?? null,
        categories: current.categories.map((category) => {
          const remote = remoteCategories.get(category.category_key);
          return remote ? {
            ...category,
            transaction_count: remote.transaction_count,
            rule_count: remote.rule_count,
            impact_months: remote.impact_months,
            conflict_product_count: remote.conflict_product_count
          } : category;
        }),
        rules: current.rules.map((rule) => {
          const remote = remoteRules.get(Number(rule.id ?? 0));
          return remote ? {
            ...rule,
            rule_status: remote.rule_status,
            duplicate_rule_ids: remote.duplicate_rule_ids,
            conflict_rule_ids: remote.conflict_rule_ids,
            occurrences: remote.occurrences,
            months_count: remote.months_count,
            last_month: remote.last_month,
            last_used_date: remote.last_used_date,
            match_level: remote.match_level
          } : rule;
        }),
        recommendations: analytics.recommendations,
        historical_products: analytics.historical_products,
        rule_conflicts: analytics.rule_conflicts,
        summary: analytics.summary
      };
    });
    setAnalyticsReady(true);
  }, [dirtyFlagsRef, setWorkspace]);

  const loadAnalytics = useCallback(async () => {
    try {
      applyAnalytics(await api.ruleWorkspaceAnalytics());
    } catch (error) {
      const message = messageFor(error);
      new Notice(message);
      onError(message);
    }
  }, [api, applyAnalytics, onError]);

  const scheduleAnalyticsLoad = useCallback(() => {
    if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
    analyticsTimer.current = hostWindow.setTimeout(() => { void loadAnalytics(); }, 0);
  }, [hostWindow, loadAnalytics]);

  useEffect(() => () => {
    if (analyticsTimer.current !== null) hostWindow.clearTimeout(analyticsTimer.current);
  }, [hostWindow]);

  return {
    analyticsReady,
    historyPanelKey,
    setAnalyticsReady,
    setHistoryPanelKey,
    applyAnalytics,
    loadAnalytics,
    scheduleAnalyticsLoad
  };
}
