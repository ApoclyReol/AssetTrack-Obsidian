import { useEffect, useState } from "react";
import type { CurrentAsset, MonthWorkspace } from "../types";
import type { AssetTrackService } from "../services/AssetTrackService";
import { changeTone } from "./analysisModel";
import { businessLabel, displayError, t } from "../i18n";
import { money } from "../domain/moneyFormat";
import { StaticTableHeader } from "./TablePrimitives";
import { Cards, ChartPanel, Empty, percent, type LoadState } from "./AnalysisPrimitives";

export function HomeAnalysis({
  api,
  dataVersion
}: {
  api: AssetTrackService;
  dataVersion: number;
}) {
  const [state, setState] = useState<
    LoadState<{ current: CurrentAsset; month: MonthWorkspace | null }>
  >({ kind: "loading" });
  useEffect(() => {
    let active = true;
    setState({ kind: "loading" });
    void api.currentAsset()
      .then(async (current) => ({
        current,
        month: current.month ? await api.month(current.month) : null
      }))
      .then((data) => active && setState({ kind: "ready", data }))
      .catch((error) => active && setState({
        kind: "error",
        message: displayError(error)
      }));
    return () => { active = false; };
  }, [api, dataVersion]);
  if (state.kind === "loading") return <Empty text={t("正在加载资产首页…", "Loading asset overview…")} />;
  if (state.kind === "error") return <Empty text={state.message} />;
  const { current, month } = state.data;
  const metrics = month?.overview.metrics;
  return (
    <>
      <div className="asset-track-analysis-heading">
        <div><h2>{t("资产首页", "Asset overview")}</h2><span>{t("最近月份：", "Latest month: ")}{current.month ?? "—"}</span></div>
      </div>
      <Cards items={[
        { label: t("现金", "Cash"), value: money(current.cash) },
        { label: t("理财本金", "Investment principal"), value: money(current.principal) },
        { label: t("资金投入资产", "Cost assets"), value: money(current.cost_assets) },
        { label: t("市场净资产", "Market net assets"), value: money(current.market_net_assets) }
      ]} />
      <p className="asset-track-analysis-note">
        {t(
          "资金投入资产用于稳定对账；市场净资产使用理财市值与理财账户现金反映当前财富。",
          "Cost assets keep reconciliation stable; market net assets use investment market value and account cash to reflect current wealth."
        )}
      </p>
      {metrics && (
        <Cards items={[
          { label: t("最近月收入", "Latest monthly income"), value: money(metrics.total_income), tone: "inflow" },
          { label: t("最近月净支出", "Latest monthly net expense"), value: money(metrics.total_expense), tone: "outflow" },
          {
            label: t("最近月储蓄", "Latest monthly savings"),
            value: money(metrics.surplus),
            tone: metrics.surplus >= 0 ? "inflow" : "outflow"
          },
          {
            label: t("最近月储蓄率", "Latest monthly savings rate"),
            value: metrics.savings_rate === null
              ? t("不可计算", "Unavailable")
              : percent(metrics.savings_rate)
          },
          {
            label: t("资产环比", "Asset change"),
            value: metrics.asset_delta === null ? t("不可比较", "Unavailable") : money(metrics.asset_delta),
            tone: changeTone(metrics.asset_delta)
          }
        ]} />
      )}
      <ChartPanel title={t("固定资产摘要", "Fixed asset summary")}>
        {current.fixed_assets.length ? (
          <div className="asset-track-table-scroll">
            <table className="asset-track-analysis-fixed-assets-table">
              <thead><tr><StaticTableHeader label={t("名称", "Name")} /><StaticTableHeader label={t("类别", "Category")} /><StaticTableHeader label={t("状态", "Status")} className="asset-track-status-column" /><StaticTableHeader label={t("购买价格", "Purchase price")} className="asset-track-amount-column" /></tr></thead>
              <tbody>
                {current.fixed_assets.map((row) => (
                  <tr key={row.asset_key ?? row.id}>
                    <td>{row.asset_name}</td>
                    <td>{row.category}</td>
                    <td className="asset-track-status-cell">{businessLabel(row.status)}</td>
                    <td className="asset-track-amount-cell">{money(row.purchase_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty text={t("当前没有在用或闲置的固定资产。", "There are no fixed assets in use or idle.")} />}
      </ChartPanel>
    </>
  );
}
