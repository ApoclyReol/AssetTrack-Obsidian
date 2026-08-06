import { describe, expect, it } from "vitest";
import { categoryKey } from "../../src/database/schema";
import { fixture } from "./databaseTestFixtures";

describe("configuration repository", () => {

it("saves category definitions and rules through separate revisions", async () => {
    const { repository } = fixture();
    const food = categoryKey("餐饮基础");
    const categorySnapshot = repository.categories();
    const categories = categorySnapshot.rows.map((row) =>
      row.category_key === food ? { ...row, name: "餐饮基础改名" } : row
    );
    await repository.saveCategories(
      categorySnapshot.revision,
      categories
    );
    expect(repository.categories().rows.find((row) => row.category_key === food)?.name).toBe("餐饮基础改名");
    const ruleSnapshot = repository.rules();
    await repository.saveRules(ruleSnapshot.revision, ruleSnapshot.rows);
    expect(repository.operationLogs(10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "save-categories", actor: "local-user" }),
      expect.objectContaining({ operation_type: "save-rules", actor: "local-user" })
    ]));
    const categoryOperation = repository.operationLogs(10).find(
      (operation) => operation.operation_type === "save-categories"
    );
    expect(categoryOperation && repository.operationDetails(categoryOperation.operation_id)).toMatchObject({
      metadata: { entity: "category" }
    });
    const before = repository.categories().rows.find((row) => row.category_key === food)?.name;
    await expect(repository.saveCategories(
      repository.categories().revision + 1,
      repository.categories().rows.map((row) =>
        row.category_key === food ? { ...row, name: "不应写入" } : row
      )
    )).rejects.toMatchObject({ status: 409 });
    expect(repository.categories().rows.find((row) => row.category_key === food)?.name).toBe(before);
  });
});
