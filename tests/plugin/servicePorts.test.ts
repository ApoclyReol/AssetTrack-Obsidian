import { describe, expectTypeOf, it } from "vitest";
import type { AssetTrackService } from "../../src/services/AssetTrackService";
import type {
  AnalysisPort,
  BackupPort,
  ConfigurationEditorPort,
  EditorShellPort,
  MonthEditorPort,
  RuntimePort
} from "../../src/services/ports";

describe("service capability ports", () => {
  it("keeps the aggregate local service assignable to every UI capability", () => {
    expectTypeOf<AssetTrackService>().toExtend<MonthEditorPort>();
    expectTypeOf<AssetTrackService>().toExtend<ConfigurationEditorPort>();
    expectTypeOf<AssetTrackService>().toExtend<EditorShellPort>();
    expectTypeOf<AssetTrackService>().toExtend<AnalysisPort>();
    expectTypeOf<AssetTrackService>().toExtend<BackupPort>();
    expectTypeOf<AssetTrackService>().toExtend<RuntimePort>();
  });
});
