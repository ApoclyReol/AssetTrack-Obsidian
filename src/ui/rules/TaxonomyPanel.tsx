import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Notice, type App } from "obsidian";
import type {
  AttributeGroup,
  AttributeOption,
  TagDefinition,
  TaxonomyRemoval,
  TaxonomyWorkspace
} from "../../types/configuration";
import type { ConfigurationEditorPort } from "../../services/ports";
import { t } from "../../i18n";
import {
  messageFor,
  type OperationState,
  Section,
  Status
} from "../editorPrimitives";
import { StaticTableHeader } from "../TablePrimitives";
import { TaxonomyEditorModal, type StagedTaxonomyRemoval } from "../TaxonomyEditorModal";

export interface TaxonomyPanelProps {
  app: App;
  api: ConfigurationEditorPort;
  view: "all";
  dataVersion?: number;
  onDataChanged: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export type TaxonomyScope = "attributes" | "tags";

export interface TaxonomyPanelHandle {
  hasUnsavedChanges: (scope?: TaxonomyScope) => boolean;
  save: (scope?: TaxonomyScope) => Promise<boolean>;
  discard: (scope?: TaxonomyScope) => Promise<void>;
}

function newKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nextSort(rows: Array<{ sort_order: number }>): number {
  return rows.length ? Math.max(...rows.map((row) => row.sort_order)) + 1 : 0;
}

interface TaxonomyTableProps {
  view: "all";
  taxonomy: TaxonomyWorkspace;
  attributeDirty: boolean;
  tagDirty: boolean;
  pending: boolean;
  canSave: boolean;
  onAddGroup: () => void;
  onUpdateGroup: (groupKey: string, name: string) => void;
  onRemoveGroup: (group: AttributeGroup) => void;
  onAddOption: (group: AttributeGroup) => void;
  onEditOption: (option: AttributeOption) => void;
  onAddTag: () => void;
  onUpdateTag: (tagKey: string, update: Partial<TagDefinition>) => void;
  onRemoveTag: (tag: TagDefinition) => void;
  onSaveAttributes: () => void;
  onSaveTags: () => void;
}

function TaxonomyTable({
  view,
  taxonomy,
  attributeDirty,
  tagDirty,
  pending,
  canSave,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onAddOption,
  onEditOption,
  onAddTag,
  onUpdateTag,
  onRemoveTag,
  onSaveAttributes,
  onSaveTags
}: TaxonomyTableProps) {
  return <div className={`asset-track-taxonomy-panels${view === "all" ? " asset-track-taxonomy-panels--split" : ""}`}>
    <Section>
      <h3>{t("分类属性", "Category attributes")}</h3>
      <div className="asset-track-table-scroll asset-track-responsive-scroll">
        <table className="asset-track-taxonomy-table"><thead><tr>
          <StaticTableHeader label={t("属性名称", "Attribute name")} />
          <StaticTableHeader label={t("属性值", "Values")} />
          <StaticTableHeader label={t("操作", "Actions")} className="asset-track-actions-heading" />
        </tr></thead>
          <tbody>{taxonomy.groups.map((group) => {
            const values = taxonomy.options.filter((option) => option.group_key === group.group_key);
            return <tr key={group.group_key}>
              <td>
                <input
                  className="asset-track-taxonomy-inline-input"
                  type="text"
                  value={group.name}
                  placeholder={t("属性名称", "Attribute name")}
                  aria-label={t("属性名称", "Attribute name")}
                  disabled={pending}
                  onChange={(event) => onUpdateGroup(group.group_key, event.target.value)}
                />
              </td>
              <td>
                <div className="asset-track-taxonomy-chips asset-track-taxonomy-value-list">
                  {values.map((option) => <button
                    type="button"
                    className="asset-track-taxonomy-chip asset-track-taxonomy-value-button"
                    key={option.attribute_key}
                    disabled={pending}
                    onClick={() => onEditOption(option)}
                    title={t("编辑属性值", "Edit attribute value")}
                  >{option.name || t("未命名", "Unnamed")}</button>)}
                  <button
                    type="button"
                    className="asset-track-taxonomy-add-button"
                    aria-label={t("新增属性值", "Add attribute value")}
                    title={t("新增属性值", "Add attribute value")}
                    disabled={pending}
                    onClick={() => onAddOption(group)}
                  >+</button>
                  {!values.length && <span className="asset-track-taxonomy-empty-chip">{t("暂无属性值", "No values")}</span>}
                </div>
              </td>
              <td className="asset-track-taxonomy-action-cell">
                <div className="asset-track-taxonomy-actions">
                  <button type="button" disabled={pending} onClick={() => onRemoveGroup(group)}>{t("移除", "Remove")}</button>
                </div>
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="asset-track-taxonomy-panel-actions">
        <button type="button" disabled={pending} onClick={onAddGroup}>{t("新增属性名称", "Add attribute name")}</button>
        <button type="button" className="mod-cta" disabled={!attributeDirty || pending || !canSave} onClick={onSaveAttributes}>{t("保存属性", "Save attributes")}</button>
      </div>
    </Section>
    <Section>
      <h3>{t("流水标签", "Transaction tags")}</h3>
      <div className="asset-track-table-scroll asset-track-responsive-scroll">
        <table className="asset-track-taxonomy-table asset-track-taxonomy-tag-table"><thead><tr>
          <StaticTableHeader label={t("名称", "Name")} />
          <StaticTableHeader label={t("说明", "Description")} />
          <StaticTableHeader label={t("颜色", "Color")} />
          <StaticTableHeader label={t("操作", "Actions")} className="asset-track-actions-heading" />
        </tr></thead>
          <tbody>{taxonomy.tags.map((tag) => <tr key={tag.tag_key}>
            <td><input className="asset-track-taxonomy-inline-input" type="text" value={tag.name} placeholder={t("标签名称", "Tag name")} disabled={pending} onChange={(event) => onUpdateTag(tag.tag_key, { name: event.target.value })} /></td>
            <td><input className="asset-track-taxonomy-inline-input" type="text" value={tag.description ?? ""} placeholder={t("可选说明", "Optional description")} disabled={pending} onChange={(event) => onUpdateTag(tag.tag_key, { description: event.target.value })} /></td>
            <td><input className="asset-track-taxonomy-color-input" type="color" value={tag.color || "#7c3aed"} aria-label={t(`${tag.name || "标签"}颜色`, `${tag.name || "Tag"} color`)} disabled={pending} onChange={(event) => onUpdateTag(tag.tag_key, { color: event.target.value })} /></td>
            <td className="asset-track-taxonomy-action-cell"><div className="asset-track-taxonomy-actions"><button type="button" disabled={pending} onClick={() => onRemoveTag(tag)}>{t("移除", "Remove")}</button></div></td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="asset-track-taxonomy-panel-actions">
        <button type="button" disabled={pending} onClick={onAddTag}>{t("新增标签", "Add tag")}</button>
        <button type="button" className="mod-cta" disabled={!tagDirty || pending || !canSave} onClick={onSaveTags}>{t("保存标签", "Save tags")}</button>
      </div>
    </Section>
  </div>;
}

export const TaxonomyPanel = forwardRef<TaxonomyPanelHandle, TaxonomyPanelProps>(function TaxonomyPanel({
  app,
  api,
  view,
  dataVersion,
  onDataChanged,
  onDirtyChange
}, ref) {
  const [taxonomy, setTaxonomy] = useState<TaxonomyWorkspace | null>(null);
  const [persisted, setPersisted] = useState<TaxonomyWorkspace | null>(null);
  const [removals, setRemovals] = useState<TaxonomyRemoval[]>([]);
  const [state, setState] = useState<OperationState>({ kind: "pending", message: t("加载属性和标签…", "Loading attributes and tags…") });
  const [attributeDirty, setAttributeDirty] = useState(false);
  const [tagDirty, setTagDirty] = useState(false);
  const requestSequence = useRef(0);
  const editGeneration = useRef(0);
  const mounted = useRef(true);
  const dataVersionInitialized = useRef(false);
  const lastDataVersion = useRef<number | undefined>(undefined);
  const dirty = attributeDirty || tagDirty;

  const markAttributeDirty = useCallback(() => {
    editGeneration.current += 1;
    setAttributeDirty(true);
    onDirtyChange?.(true);
  }, [onDirtyChange]);
  const markTagDirty = useCallback(() => {
    editGeneration.current += 1;
    setTagDirty(true);
    onDirtyChange?.(true);
  }, [onDirtyChange]);

  const load = useCallback(async (force = false): Promise<void> => {
    if (!api.taxonomy) {
      setState({ kind: "error", message: t("当前服务不支持属性和标签配置。", "This service does not support attribute and tag configuration.") });
      return;
    }
    const sequence = ++requestSequence.current;
    const generation = editGeneration.current;
    setState({ kind: "pending", message: t("加载属性和标签…", "Loading attributes and tags…") });
    try {
      const loaded = await api.taxonomy();
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (!force && generation !== editGeneration.current) {
        setState({ kind: "error", message: t("加载期间产生了新修改，当前草稿已保留。", "New edits were made while loading; the current draft was preserved.") });
        return;
      }
      setTaxonomy(loaded);
      setPersisted(loaded);
      setRemovals([]);
      setAttributeDirty(false);
      setTagDirty(false);
      editGeneration.current += 1;
      onDirtyChange?.(false);
      setState({ kind: "idle" });
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, onDirtyChange]);

  useEffect(() => () => {
    mounted.current = false;
    requestSequence.current += 1;
  }, []);

  useEffect(() => {
    if (!dataVersionInitialized.current) {
      dataVersionInitialized.current = true;
      lastDataVersion.current = dataVersion;
      void load();
      return;
    }
    if (lastDataVersion.current === dataVersion) return;
    lastDataVersion.current = dataVersion;
    if (!dirty) void load();
  }, [dataVersion, dirty, load]);

  const stageRemovals = useCallback((drafts: StagedTaxonomyRemoval[]): void => {
    if (!persisted || !taxonomy) return;
    const next = drafts.flatMap(({ kind, key, decision }): TaxonomyRemoval[] => {
      const original = kind === "group" ? persisted.groups.find((item) => item.group_key === key)
        : kind === "option" ? persisted.options.find((item) => item.attribute_key === key)
          : persisted.tags.find((item) => item.tag_key === key);
      if (!original) return [];
      const count = kind === "group" ? (original as AttributeGroup).usage_count ?? 0
        : kind === "option" ? (original as AttributeOption).category_count ?? 0
          : (original as TagDefinition).transaction_count ?? 0;
      const target = kind === "group" && decision.target_key
        ? taxonomy.options.find((item) => item.attribute_key === decision.target_key) : undefined;
      return [{
        kind,
        key,
        action: decision.action,
        target_key: decision.target_key,
        expected_count: count,
        expected_usage_revision: original.usage_revision ?? 0,
        expected_target_group_usage_revision: target
          ? persisted.groups.find((item) => item.group_key === target.group_key)?.usage_revision
          : undefined
      }];
    });
    const removedGroup = drafts.find((item) => item.kind === "group")?.key;
    setRemovals((current) => [...current.filter((item) =>
      !next.some((replacement) => replacement.key === item.key)
      && (!removedGroup || item.kind !== "option"
        || persisted.options.find((option) => option.attribute_key === item.key)?.group_key !== removedGroup)), ...next]);
  }, [persisted, taxonomy]);

  const updateGroup = useCallback((groupKey: string, name: string) => {
    setTaxonomy((current) => current ? {
      ...current,
      groups: current.groups.map((group) => group.group_key === groupKey ? { ...group, name } : group)
    } : current);
    markAttributeDirty();
  }, [markAttributeDirty]);

  const updateTag = useCallback((tagKey: string, update: Partial<TagDefinition>) => {
    setTaxonomy((current) => current ? {
      ...current,
      tags: current.tags.map((tag) => tag.tag_key === tagKey ? { ...tag, ...update } : tag)
    } : current);
    markTagDirty();
  }, [markTagDirty]);

  const editOption = useCallback((option: AttributeOption | null, drafts: StagedTaxonomyRemoval[]) => {
    stageRemovals(drafts);
    setTaxonomy((current) => {
      if (!current) return current;
      if (!option) return {
        ...current,
        options: current.options.filter((item) => !drafts.some((draft) => draft.kind === "option" && draft.key === item.attribute_key))
      };
      return {
        ...current,
        options: current.options.some((item) => item.attribute_key === option.attribute_key)
          ? current.options.map((item) => item.attribute_key === option.attribute_key ? option : item)
          : [...current.options, option]
      };
    });
    markAttributeDirty();
  }, [markAttributeDirty, stageRemovals]);

  const removeGroup = useCallback((group: AttributeGroup) => {
    new TaxonomyEditorModal({
      app,
      kind: "group",
      group,
      groups: taxonomy?.groups ?? [],
      options: taxonomy?.options ?? [],
      tags: taxonomy?.tags ?? [],
      onApply: (next, _values, drafts) => {
        if (!next) {
          stageRemovals(drafts);
          setTaxonomy((current) => current ? {
            ...current,
            groups: current.groups.filter((item) => item.group_key !== group.group_key),
            options: current.options.filter((item) => item.group_key !== group.group_key)
          } : current);
          markAttributeDirty();
        }
      }
    }).open();
  }, [app, markAttributeDirty, stageRemovals, taxonomy]);

  const removeTag = useCallback((tag: TagDefinition) => {
    new TaxonomyEditorModal({
      app,
      kind: "tag",
      tag,
      groups: taxonomy?.groups ?? [],
      options: taxonomy?.options ?? [],
      tags: taxonomy?.tags ?? [],
      onApply: (next, drafts) => {
        if (!next) {
          stageRemovals(drafts);
          setTaxonomy((current) => current ? { ...current, tags: current.tags.filter((item) => item.tag_key !== tag.tag_key) } : current);
          markTagDirty();
        }
      }
    }).open();
  }, [app, markTagDirty, stageRemovals, taxonomy]);

  const addOption = useCallback((group: AttributeGroup) => {
    const option: AttributeOption = {
      attribute_key: newKey("attr"),
      group_key: group.group_key,
      name: "",
      is_active: true,
      sort_order: nextSort((taxonomy?.options ?? []).filter((item) => item.group_key === group.group_key))
    };
    new TaxonomyEditorModal({
      app,
      kind: "option",
      option,
      groups: taxonomy?.groups ?? [],
      options: taxonomy?.options ?? [],
      tags: taxonomy?.tags ?? [],
      onApply: (next) => { if (next?.name.trim()) editOption(next, []); }
    }).open();
  }, [app, editOption, taxonomy]);

  const addGroup = useCallback(() => {
    const group: AttributeGroup = {
      group_key: newKey("attr-group"),
      name: "",
      selection_mode: "single",
      is_active: true,
      sort_order: nextSort(taxonomy?.groups ?? [])
    };
    setTaxonomy((current) => current ? { ...current, groups: [...current.groups, group] } : current);
    markAttributeDirty();
  }, [markAttributeDirty, taxonomy?.groups]);

  const addTag = useCallback(() => {
    const tag: TagDefinition = {
      tag_key: newKey("tag"),
      name: "",
      description: "",
      color: "#7c3aed",
      is_active: true,
      sort_order: nextSort(taxonomy?.tags ?? [])
    };
    setTaxonomy((current) => current ? { ...current, tags: [...current.tags, tag] } : current);
    markTagDirty();
  }, [markTagDirty, taxonomy?.tags]);

  const save = useCallback(async (scope?: TaxonomyScope): Promise<boolean> => {
    if (!taxonomy || !persisted || !api.saveTaxonomy) return false;
    const writeAttributes = scope === undefined || scope === "attributes";
    const writeTags = scope === undefined || scope === "tags";
    const scopeDirty = writeAttributes && attributeDirty || writeTags && tagDirty;
    if (scope !== undefined && !scopeDirty) return true;
    const sequence = ++requestSequence.current;
    const generation = editGeneration.current;
    setState({ kind: "pending", message: t("保存属性和标签…", "Saving attributes and tags…") });
    try {
      const saved = await api.saveTaxonomy(
        taxonomy.attribute_revision,
        writeAttributes ? taxonomy.groups : persisted.groups,
        writeAttributes ? taxonomy.options : persisted.options,
        taxonomy.tag_revision,
        writeTags ? taxonomy.tags : persisted.tags,
        removals.filter((item) => scope === undefined
          || (scope === "attributes" ? item.kind !== "tag" : item.kind === "tag"))
      );
      if (!mounted.current || sequence !== requestSequence.current) return false;
      if (generation !== editGeneration.current) {
        setState({ kind: "error", message: t("保存已完成，但期间产生了新修改；当前草稿已保留，请重新加载后再保存。", "The save completed, but new edits were made while it was in flight; the current draft was preserved. Reload before saving again.") });
        onDataChanged();
        return false;
      }
      setPersisted(saved);
      const nextAttributeDirty = writeAttributes ? false : attributeDirty;
      const nextTagDirty = writeTags ? false : tagDirty;
      setTaxonomy({
        ...saved,
        groups: writeAttributes ? saved.groups : taxonomy.groups,
        options: writeAttributes ? saved.options : taxonomy.options,
        tags: writeTags ? saved.tags : taxonomy.tags
      });
      setRemovals((current) => current.filter((item) => scope === undefined
        ? false
        : scope === "attributes" ? item.kind === "tag" : item.kind !== "tag"));
      setAttributeDirty(nextAttributeDirty);
      setTagDirty(nextTagDirty);
      editGeneration.current += 1;
      onDirtyChange?.(nextAttributeDirty || nextTagDirty);
      setState({ kind: "idle" });
      onDataChanged();
      new Notice(scope === "attributes"
        ? t("分类属性已保存。", "Category attributes saved.")
        : scope === "tags"
          ? t("流水标签已保存。", "Transaction tags saved.")
          : t("属性和标签已保存。", "Attributes and tags saved."));
      return true;
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return false;
      const message = messageFor(error);
      setState({ kind: "idle" });
      new Notice(message);
      return false;
    }
  }, [api, attributeDirty, onDataChanged, onDirtyChange, persisted, removals, tagDirty, taxonomy]);

  const discard = useCallback(async (scope?: TaxonomyScope): Promise<void> => {
    if (scope === undefined) {
      await load(true);
      return;
    }
    if (!api.taxonomy || !taxonomy) return;
    const sequence = ++requestSequence.current;
    const generation = editGeneration.current;
    setState({ kind: "pending", message: t("重载属性和标签…", "Reloading attributes and tags…") });
    try {
      const loaded = await api.taxonomy();
      if (!mounted.current || sequence !== requestSequence.current) return;
      if (generation !== editGeneration.current) {
        setState({ kind: "error", message: t("重载期间产生了新修改，当前草稿已保留。", "New edits were made while reloading; the current draft was preserved.") });
        return;
      }
      setPersisted(loaded);
      setTaxonomy((current) => current ? {
        ...loaded,
        groups: scope === "attributes" ? loaded.groups : current.groups,
        options: scope === "attributes" ? loaded.options : current.options,
        tags: scope === "tags" ? loaded.tags : current.tags
      } : loaded);
      setRemovals((current) => current.filter((item) =>
        scope === "attributes" ? item.kind === "tag" : item.kind !== "tag"));
      const nextAttributeDirty = scope === "attributes" ? false : attributeDirty;
      const nextTagDirty = scope === "tags" ? false : tagDirty;
      setAttributeDirty(nextAttributeDirty);
      setTagDirty(nextTagDirty);
      editGeneration.current += 1;
      onDirtyChange?.(nextAttributeDirty || nextTagDirty);
      setState({ kind: "idle" });
    } catch (error) {
      if (!mounted.current || sequence !== requestSequence.current) return;
      setState({ kind: "error", message: messageFor(error) });
    }
  }, [api, attributeDirty, load, onDirtyChange, tagDirty, taxonomy]);

  useImperativeHandle(ref, () => ({
    hasUnsavedChanges: (scope) => scope === "attributes" ? attributeDirty
      : scope === "tags" ? tagDirty : dirty,
    save,
    discard
  }), [attributeDirty, discard, dirty, save, tagDirty]);

  if (!taxonomy) return <Section><Status state={state} /></Section>;
  return <>
    <TaxonomyTable
      view={view}
      taxonomy={taxonomy}
      attributeDirty={attributeDirty}
      tagDirty={tagDirty}
      pending={state.kind === "pending"}
      canSave={Boolean(api.saveTaxonomy)}
      onAddGroup={addGroup}
      onUpdateGroup={updateGroup}
      onRemoveGroup={removeGroup}
      onAddOption={addOption}
      onEditOption={(option) => new TaxonomyEditorModal({
        app,
        kind: "option",
        option,
        groups: taxonomy.groups,
        options: taxonomy.options,
        tags: taxonomy.tags,
        onApply: editOption
      }).open()}
      onAddTag={addTag}
      onUpdateTag={updateTag}
      onRemoveTag={removeTag}
      onSaveAttributes={() => { void save("attributes"); }}
      onSaveTags={() => { void save("tags"); }}
    />
  </>;
});
