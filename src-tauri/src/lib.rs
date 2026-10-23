use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

const MAX_IMAGE_DATA_LENGTH: usize = 7_000_000;

const MIGRATION_1: &str = r#"
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        purchase REAL NOT NULL CHECK (purchase >= 0),
        purchase_date TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_stock', 'sold')),
        sale REAL,
        shipping REAL,
        platform_fee REAL,
        other_fee REAL,
        sale_date TEXT,
        note TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
      CREATE INDEX IF NOT EXISTS idx_items_purchase_date ON items(purchase_date);
      CREATE INDEX IF NOT EXISTS idx_items_sale_date ON items(sale_date);
    "#;

const MIGRATION_2: &str = r#"
  ALTER TABLE items RENAME TO items_legacy_v1;
  CREATE TABLE items (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
    purchase_cents INTEGER NOT NULL CHECK (purchase_cents >= 0), purchase_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('in_stock', 'sold')),
    expected_sale_cents INTEGER, sale_cents INTEGER, shipping_cents INTEGER,
    platform_fee_cents INTEGER, other_fee_cents INTEGER, sale_date TEXT, platform TEXT,
    note TEXT, tags_json TEXT NOT NULL DEFAULT '[]', image_data TEXT,
    created_at INTEGER NOT NULL, deleted_at INTEGER
  );
  INSERT INTO items (id,name,category,purchase_cents,purchase_date,status,sale_cents,
    shipping_cents,platform_fee_cents,other_fee_cents,sale_date,note,created_at)
  SELECT id,name,category,CAST(ROUND(purchase*100) AS INTEGER),purchase_date,status,
    CASE WHEN sale IS NULL THEN NULL ELSE CAST(ROUND(sale*100) AS INTEGER) END,
    CASE WHEN shipping IS NULL THEN NULL ELSE CAST(ROUND(shipping*100) AS INTEGER) END,
    CASE WHEN platform_fee IS NULL THEN NULL ELSE CAST(ROUND(platform_fee*100) AS INTEGER) END,
    CASE WHEN other_fee IS NULL THEN NULL ELSE CAST(ROUND(other_fee*100) AS INTEGER) END,
    sale_date,note,created_at FROM items_legacy_v1;
  DROP TABLE items_legacy_v1;
  CREATE INDEX idx_items_status ON items(status);
  CREATE INDEX idx_items_purchase_date ON items(purchase_date);
  CREATE INDEX idx_items_sale_date ON items(sale_date);
  CREATE INDEX idx_items_deleted_at ON items(deleted_at);
  CREATE TABLE categories (name TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL);
  INSERT INTO categories(name,created_at) VALUES
    ('鞋',1),('衣服',2),('首饰',3),('美妆',4),('电子产品',5),('虚拟道具',6);
  CREATE TABLE fee_templates (
    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, platform TEXT NOT NULL,
    shipping_cents INTEGER NOT NULL DEFAULT 0, platform_fee_cents INTEGER NOT NULL DEFAULT 0,
    other_fee_cents INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
"#;

const MIGRATION_3: &str = r#"
  ALTER TABLE items ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1);
"#;

// 库存变动独立于商品主记录保存。这样后续的入库、盘点调整和部分售出
// 都可以完整追溯，而不会覆盖原有商品数据或影响旧版本的数据读取。
const MIGRATION_4: &str = r#"
  CREATE TABLE inventory_movements (
    id TEXT PRIMARY KEY NOT NULL,
    item_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('stock_in', 'adjustment', 'partial_sale')),
    quantity_delta INTEGER NOT NULL,
    quantity_before INTEGER NOT NULL CHECK (quantity_before >= 0),
    quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
    unit_cents INTEGER CHECK (unit_cents >= 0),
    shipping_cents INTEGER NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0),
    shipping_mode TEXT CHECK (shipping_mode IN ('per_order', 'per_unit')),
    platform_fee_value INTEGER NOT NULL DEFAULT 0 CHECK (platform_fee_value >= 0),
    platform_fee_mode TEXT CHECK (platform_fee_mode IN ('fixed', 'percent')),
    other_fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (other_fee_cents >= 0),
    other_fee_mode TEXT CHECK (other_fee_mode IN ('per_order', 'per_unit')),
    note TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX idx_inventory_movements_item_created_at
    ON inventory_movements(item_id, created_at DESC);
"#;

const MIGRATION_5: &str = r#"
  ALTER TABLE items ADD COLUMN payment_status TEXT CHECK (payment_status IN ('pending','received','historical'));
  ALTER TABLE items ADD COLUMN received_date TEXT;
  ALTER TABLE items ADD COLUMN received_cents INTEGER CHECK (received_cents >= 0);
  UPDATE items SET payment_status='historical' WHERE status='sold';
  CREATE TABLE ledger_finance (id INTEGER PRIMARY KEY CHECK (id=1), value TEXT NOT NULL);
"#;

const MIGRATION_6: &str = r#"
  ALTER TABLE items ADD COLUMN settlement_expected_cents INTEGER CHECK (settlement_expected_cents >= 0);
  ALTER TABLE items ADD COLUMN settlement_reason TEXT;
"#;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = migrations();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commit_data,
            upsert_item,
            record_inventory_movement,
            change_item_categories,
            set_items_deleted,
            permanently_delete_items
        ])
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:income-ledger.db", migrations)
                .build(),
        )
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_items_table",
            sql: MIGRATION_1,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "money_cents_and_business_fields",
            sql: MIGRATION_2,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "item_quantity",
            sql: MIGRATION_3,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "inventory_movements",
            sql: MIGRATION_4,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "receipts_and_finance",
            sql: MIGRATION_5,
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "receipt_reconciliation",
            sql: MIGRATION_6,
            kind: MigrationKind::Up,
        },
    ]
}

fn non_empty_string(value: &serde_json::Value, field: &str) -> Result<(), String> {
    if value
        .get(field)
        .and_then(serde_json::Value::as_str)
        .is_some_and(|value| !value.trim().is_empty())
    {
        Ok(())
    } else {
        Err(format!("{} 必须是非空文本", field))
    }
}

fn non_negative_integer(
    value: &serde_json::Value,
    field: &str,
    required: bool,
) -> Result<(), String> {
    match value.get(field) {
        None | Some(serde_json::Value::Null) if !required => Ok(()),
        Some(value) if value.as_i64().is_some_and(|number| number >= 0) => Ok(()),
        _ => Err(format!("{} 必须是非负整数", field)),
    }
}

fn validate_item(value: &serde_json::Value) -> Result<(), String> {
    let item = value.as_object().ok_or("商品记录必须是对象")?;
    for field in ["id", "name", "category", "purchaseDate", "status"] {
        non_empty_string(value, field)?;
    }
    match item.get("status").and_then(serde_json::Value::as_str) {
        Some("in_stock") | Some("sold") => {}
        _ => return Err("status 必须是 in_stock 或 sold".into()),
    }
    for field in ["purchaseCents", "createdAt"] {
        non_negative_integer(value, field, true)?;
    }
    if let Some(quantity) = item.get("quantity") {
        if !quantity.as_i64().is_some_and(|number| number >= 1) {
            return Err("quantity 必须是大于 0 的整数".into());
        }
    }
    for field in [
        "expectedSaleCents",
        "saleCents",
        "shippingCents",
        "platformFeeCents",
        "otherFeeCents",
        "deletedAt",
    ] {
        non_negative_integer(value, field, false)?;
    }
    if !item.get("tags").is_some_and(|tags| {
        tags.as_array()
            .is_some_and(|tags| tags.iter().all(|tag| tag.is_string()))
    }) {
        return Err("tags 必须是文本数组".into());
    }
    if let Some(image) = item.get("imageData") {
        if !image.is_null() {
            let image = image
                .as_str()
                .ok_or("imageData 必须是图片 data URL 或 null")?;
            if !image.starts_with("data:image/")
                || !image.contains(";base64,")
                || image.len() > MAX_IMAGE_DATA_LENGTH
            {
                return Err("图片格式无效或超过 5 MB 限制".into());
            }
        }
    }
    if item.get("status").and_then(serde_json::Value::as_str) == Some("sold") {
        non_negative_integer(value, "saleCents", true)?;
        non_empty_string(value, "saleDate")?;
    }
    let status = value
        .get("paymentStatus")
        .and_then(serde_json::Value::as_str);
    if let Some(status) = status {
        if !["pending", "received", "historical"].contains(&status) {
            return Err("回款状态无效".into());
        }
    }
    non_negative_integer(value, "receivedCents", false)?;
    non_negative_integer(value, "settlementExpectedCents", false)?;
    if !value["settlementReason"].is_null() && !value["settlementReason"].is_string() {
        return Err("结算差额原因必须是文本".into());
    }
    if status != Some("received")
        && (!value["settlementExpectedCents"].is_null() || !value["settlementReason"].is_null())
    {
        return Err("未到账不能有结算核对信息".into());
    }
    if status == Some("received") {
        non_negative_integer(value, "receivedCents", true)?;
        non_empty_string(value, "receivedDate")?;
        let received = value["receivedDate"].as_str().unwrap();
        if !valid_date(received) || received < value["saleDate"].as_str().unwrap_or("") {
            return Err("到账日期无效或早于卖出日期".into());
        }
    } else if !value["receivedDate"].is_null() || !value["receivedCents"].is_null() {
        return Err("未到账不能有到账金额和日期".into());
    }
    if value["status"] == "in_stock" && status.is_some() {
        return Err("库存商品不能记录回款".into());
    }
    Ok(())
}

fn valid_date(date: &str) -> bool {
    let parts: Vec<_> = date.split('-').collect();
    if parts.len() != 3 || parts[0].len() != 4 || parts[1].len() != 2 || parts[2].len() != 2 {
        return false;
    }
    let parsed: Vec<_> = parts
        .iter()
        .map(|v| v.parse::<u32>().unwrap_or(0))
        .collect();
    let (y, m, d) = (parsed[0], parsed[1], parsed[2]);
    let max = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    y >= 100 && d >= 1 && d <= max
}

fn validate_finance(value: &serde_json::Value) -> Result<(), String> {
    non_negative_integer(value, "capitalLimitCents", true)?;
    non_negative_integer(value, "cashCents", false)?;
    if !value["cashCents"].is_null() && !value["cashCheckedDate"].as_str().is_some_and(valid_date) {
        return Err("现金核对日期无效".into());
    }
    let records = value["afterSales"].as_array().ok_or("售后记录必须是数组")?;
    let mut ids = std::collections::HashSet::new();
    for a in records {
        for field in ["id", "itemId", "reason"] {
            non_empty_string(a, field)?;
        }
        if !ids.insert(a["id"].as_str().unwrap()) {
            return Err("售后ID重复".into());
        }
        if !a["date"].as_str().is_some_and(valid_date) {
            return Err("售后日期无效".into());
        }
        for field in ["refundCents", "quantity", "lossCents"] {
            non_negative_integer(a, field, true)?;
        }
        let q = a["quantity"].as_i64().unwrap();
        match a["kind"].as_str() {
            Some("partial_refund") if q == 0 => {}
            Some("return") if q > 0 => {}
            Some("write_off") if q > 0 && a["refundCents"] == 0 => {}
            _ => return Err("售后类型与数量不匹配".into()),
        }
        if !a["recoveredDate"].is_null()
            && (a["kind"] != "return"
                || a["returnedItemId"].as_str().is_none()
                || !a["recoveredDate"].as_str().is_some_and(valid_date)
                || a["recoveredDate"].as_str() < a["date"].as_str())
        {
            return Err("收回商品日期无效".into());
        }
    }
    Ok(())
}

fn validate_items(value: &serde_json::Value) -> Result<(), String> {
    let items = value.as_array().ok_or("items 必须是数组")?;
    if items.is_empty() {
        return Err("商品同步不能为空；如需清空请使用专用操作".into());
    }
    let mut ids = std::collections::HashSet::new();
    for item in items {
        validate_item(item)?;
        let id = item.get("id").and_then(serde_json::Value::as_str).unwrap();
        if !ids.insert(id) {
            return Err(format!("商品记录 ID 重复：{}", id));
        }
    }
    Ok(())
}

fn validate_categories(value: &serde_json::Value) -> Result<(), String> {
    let categories = value.as_array().ok_or("categories 必须是数组")?;
    if categories.is_empty() {
        return Err("至少保留一个商品分类".into());
    }
    let mut names = std::collections::HashSet::new();
    for category in categories {
        let name = category
            .as_str()
            .filter(|name| !name.trim().is_empty())
            .ok_or("分类必须是非空文本")?;
        if !names.insert(name) {
            return Err(format!("分类重复：{}", name));
        }
    }
    Ok(())
}

fn validate_templates(value: &serde_json::Value) -> Result<(), String> {
    let templates = value.as_array().ok_or("templates 必须是数组")?;
    let mut ids = std::collections::HashSet::new();
    for template in templates {
        for field in ["id", "name", "platform"] {
            non_empty_string(template, field)?;
        }
        for field in [
            "shippingCents",
            "platformFeeCents",
            "otherFeeCents",
            "createdAt",
        ] {
            non_negative_integer(template, field, true)?;
        }
        let id = template
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap();
        if !ids.insert(id) {
            return Err(format!("费用模板 ID 重复：{}", id));
        }
    }
    Ok(())
}

fn validate_inventory_movements(value: &serde_json::Value) -> Result<(), String> {
    let movements = value.as_array().ok_or("库存变动必须是数组")?;
    let mut ids = std::collections::HashSet::new();
    for movement in movements {
        validate_inventory_movement(movement)?;
        let id = movement
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap();
        if !ids.insert(id) {
            return Err(format!("库存变动 ID 重复：{}", id));
        }
    }
    Ok(())
}

fn validate_commit_data(data: &serde_json::Value) -> Result<(), String> {
    let data = data.as_object().ok_or("数据必须是对象")?;
    if data.is_empty() {
        return Err("至少提供一项待保存数据".into());
    }
    if let Some(items) = data.get("items") {
        validate_items(items)?;
    }
    if let Some(items) = data.get("itemUpdates") {
        validate_items(items)?;
    }
    if let Some(finance) = data.get("finance") {
        validate_finance(finance)?;
    }
    if let Some(categories) = data.get("categories") {
        validate_categories(categories)?;
    }
    if let Some(templates) = data.get("templates") {
        validate_templates(templates)?;
    }
    if let Some(movements) = data.get("inventoryMovements") {
        validate_inventory_movements(movements)?;
    }
    Ok(())
}

/// imageData 缺席表示保留已有图片；显式 JSON null 表示清除图片。
/// 先清除显式 null，再以 COALESCE 合并，避免 SQLite 的 json_extract 混淆缺键与 null。
async fn sync_items(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    records: &str,
) -> Result<(), String> {
    // 仅当写入载荷显式提供 quantity 时才改写既有库存；缺席字段必须保留，
    // 以防新增调用方漏传数量时把库存静默重置为 1。
    sqlx::query("UPDATE items SET quantity=(SELECT json_extract(value,'$.quantity') FROM json_each(?) WHERE json_extract(value,'$.id')=items.id) WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_type(value,'$.quantity') IS NOT NULL)")
    .bind(records).bind(records).execute(&mut **tx).await.map_err(|error| error.to_string())?;
    sqlx::query("UPDATE items SET image_data=NULL WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?) WHERE json_type(value,'$.imageData')='null')")
    .bind(records).execute(&mut **tx).await.map_err(|error| error.to_string())?;
    sqlx::query(r#"INSERT INTO items
    (id,name,category,purchase_cents,quantity,purchase_date,status,expected_sale_cents,sale_cents,
     shipping_cents,platform_fee_cents,other_fee_cents,sale_date,platform,note,tags_json,image_data,created_at,deleted_at,payment_status,received_date,received_cents,settlement_expected_cents,settlement_reason)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.category'),
     json_extract(value,'$.purchaseCents'),COALESCE(json_extract(value,'$.quantity'),1),json_extract(value,'$.purchaseDate'),json_extract(value,'$.status'),
     json_extract(value,'$.expectedSaleCents'),json_extract(value,'$.saleCents'),
     json_extract(value,'$.shippingCents'),json_extract(value,'$.platformFeeCents'),json_extract(value,'$.otherFeeCents'),
     json_extract(value,'$.saleDate'),json_extract(value,'$.platform'),json_extract(value,'$.note'),
     COALESCE(json_extract(value,'$.tags'),'[]'),json_extract(value,'$.imageData'),
     json_extract(value,'$.createdAt'),json_extract(value,'$.deletedAt'),CASE WHEN json_extract(value,'$.status')='sold' THEN COALESCE(json_extract(value,'$.paymentStatus'),'historical') END,json_extract(value,'$.receivedDate'),json_extract(value,'$.receivedCents'),json_extract(value,'$.settlementExpectedCents'),json_extract(value,'$.settlementReason') FROM json_each(?) WHERE true
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,category=excluded.category,purchase_cents=excluded.purchase_cents,quantity=items.quantity,purchase_date=excluded.purchase_date,status=excluded.status,expected_sale_cents=excluded.expected_sale_cents,sale_cents=excluded.sale_cents,shipping_cents=excluded.shipping_cents,platform_fee_cents=excluded.platform_fee_cents,other_fee_cents=excluded.other_fee_cents,sale_date=excluded.sale_date,platform=excluded.platform,note=excluded.note,tags_json=excluded.tags_json,image_data=COALESCE(excluded.image_data,items.image_data),deleted_at=excluded.deleted_at,payment_status=excluded.payment_status,received_date=excluded.received_date,received_cents=excluded.received_cents,settlement_expected_cents=excluded.settlement_expected_cents,settlement_reason=excluded.settlement_reason
  "#).bind(records).execute(&mut **tx).await.map_err(|error| error.to_string())?;
    Ok(())
}

async fn write_items(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    items: &serde_json::Value,
) -> Result<(), String> {
    validate_items(items)?;
    let records = items.to_string();
    sqlx::query(
        "DELETE FROM items WHERE id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))",
    )
    .bind(&records)
    .execute(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    sync_items(tx, &records).await
}

async fn commit_in_pool(pool: &sqlx::SqlitePool, data: &serde_json::Value) -> Result<(), String> {
    validate_commit_data(data)?;
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    if let Some(items) = data.get("items") {
        write_items(&mut tx, items).await?;
    }
    if let Some(items) = data.get("itemUpdates") {
        sync_items(&mut tx, &items.to_string()).await?;
    }
    if let Some(finance) = data.get("finance") {
        sqlx::query("INSERT INTO ledger_finance(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").bind(finance.to_string()).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    }
    if let Some(categories) = data.get("categories") {
        sqlx::query("DELETE FROM categories")
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query("INSERT INTO categories(name,created_at) SELECT value, CAST(key AS INTEGER) FROM json_each(?)")
      .bind(categories.to_string()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }
    if let Some(templates) = data.get("templates") {
        sqlx::query("DELETE FROM fee_templates")
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query(r#"INSERT INTO fee_templates(id,name,platform,shipping_cents,platform_fee_cents,other_fee_cents,created_at)
      SELECT json_extract(value,'$.id'),json_extract(value,'$.name'),json_extract(value,'$.platform'),
      json_extract(value,'$.shippingCents'),json_extract(value,'$.platformFeeCents'),
      json_extract(value,'$.otherFeeCents'),json_extract(value,'$.createdAt') FROM json_each(?)"#)
      .bind(templates.to_string()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }
    if let Some(movements) = data.get("inventoryMovements") {
        sqlx::query("DELETE FROM inventory_movements")
            .execute(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
        sqlx::query(r#"INSERT INTO inventory_movements
          (id,item_id,kind,quantity_delta,quantity_before,quantity_after,unit_cents,shipping_cents,shipping_mode,platform_fee_value,platform_fee_mode,other_fee_cents,other_fee_mode,note,created_at)
          SELECT json_extract(value,'$.id'),json_extract(value,'$.itemId'),json_extract(value,'$.kind'),json_extract(value,'$.quantityDelta'),json_extract(value,'$.quantityBefore'),json_extract(value,'$.quantityAfter'),json_extract(value,'$.unitCents'),json_extract(value,'$.shippingCents'),json_extract(value,'$.shippingMode'),json_extract(value,'$.platformFeeValue'),json_extract(value,'$.platformFeeMode'),json_extract(value,'$.otherFeeCents'),json_extract(value,'$.otherFeeMode'),json_extract(value,'$.note'),json_extract(value,'$.createdAt') FROM json_each(?)"#)
          .bind(movements.to_string()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    }
    tx.commit().await.map_err(|error| error.to_string())
}

async fn upsert_in_pool(pool: &sqlx::SqlitePool, record: &serde_json::Value) -> Result<(), String> {
    validate_item(record)?;
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let records = serde_json::json!([record]).to_string();
    match sync_items(&mut tx, &records).await {
        Ok(()) => tx.commit().await.map_err(|error| error.to_string()),
        Err(error) => {
            let _ = tx.rollback().await;
            Err(error)
        }
    }
}

fn validate_inventory_movement(value: &serde_json::Value) -> Result<(), String> {
    for field in ["id", "itemId", "kind"] {
        non_empty_string(value, field)?;
    }
    match value.get("kind").and_then(serde_json::Value::as_str) {
        Some("stock_in") | Some("adjustment") | Some("partial_sale") => {}
        _ => return Err("库存变动类型无效".into()),
    }
    let delta = value
        .get("quantityDelta")
        .and_then(serde_json::Value::as_i64)
        .filter(|number| *number != 0)
        .ok_or("数量变动必须是非零整数")?;
    let before = value
        .get("quantityBefore")
        .and_then(serde_json::Value::as_i64)
        .filter(|number| *number >= 0)
        .ok_or("变动前数量无效")?;
    let after = value
        .get("quantityAfter")
        .and_then(serde_json::Value::as_i64)
        .filter(|number| *number >= 1)
        .ok_or("变动后数量至少为 1")?;
    if before + delta != after {
        return Err("库存变动前后数量不一致".into());
    }
    for field in [
        "shippingCents",
        "platformFeeValue",
        "otherFeeCents",
        "createdAt",
    ] {
        non_negative_integer(value, field, true)?;
    }
    Ok(())
}

async fn record_inventory_movement_in_pool(
    pool: &sqlx::SqlitePool,
    record: &serde_json::Value,
    movement: &serde_json::Value,
    sold_record: Option<&serde_json::Value>,
) -> Result<(), String> {
    validate_item(record)?;
    validate_inventory_movement(movement)?;
    let item_id = record
        .get("id")
        .and_then(serde_json::Value::as_str)
        .unwrap();
    if movement.get("itemId").and_then(serde_json::Value::as_str) != Some(item_id) {
        return Err("库存变动的商品 ID 不匹配".into());
    }
    let before = movement
        .get("quantityBefore")
        .and_then(serde_json::Value::as_i64)
        .unwrap();
    let after = movement
        .get("quantityAfter")
        .and_then(serde_json::Value::as_i64)
        .unwrap();
    if record
        .get("quantity")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or(1)
        != after
    {
        return Err("商品数量与库存变动不一致".into());
    }
    if let Some(sold_record) = sold_record {
        validate_item(sold_record)?;
        let expected_quantity = movement
            .get("quantityDelta")
            .and_then(serde_json::Value::as_i64)
            .map(|value| -value);
        if sold_record
            .get("status")
            .and_then(serde_json::Value::as_str)
            != Some("sold")
            || sold_record.get("id").and_then(serde_json::Value::as_str) == Some(item_id)
            || sold_record
                .get("quantity")
                .and_then(serde_json::Value::as_i64)
                != expected_quantity
        {
            return Err("部分售出记录无效".into());
        }
    }
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let current: Option<i64> =
        sqlx::query_scalar("SELECT quantity FROM items WHERE id=? AND deleted_at IS NULL")
            .bind(item_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|error| error.to_string())?;
    if current != Some(before) {
        let _ = tx.rollback().await;
        return Err("商品库存已发生变化，请刷新后重试".into());
    }
    let records = match sold_record {
        Some(sold_record) => serde_json::json!([record, sold_record]).to_string(),
        None => serde_json::json!([record]).to_string(),
    };
    sync_items(&mut tx, &records).await?;
    sqlx::query(r#"INSERT INTO inventory_movements
      (id,item_id,kind,quantity_delta,quantity_before,quantity_after,unit_cents,shipping_cents,shipping_mode,platform_fee_value,platform_fee_mode,other_fee_cents,other_fee_mode,note,created_at)
      SELECT json_extract(?1,'$.id'),json_extract(?1,'$.itemId'),json_extract(?1,'$.kind'),json_extract(?1,'$.quantityDelta'),json_extract(?1,'$.quantityBefore'),json_extract(?1,'$.quantityAfter'),json_extract(?1,'$.unitCents'),json_extract(?1,'$.shippingCents'),json_extract(?1,'$.shippingMode'),json_extract(?1,'$.platformFeeValue'),json_extract(?1,'$.platformFeeMode'),json_extract(?1,'$.otherFeeCents'),json_extract(?1,'$.otherFeeMode'),json_extract(?1,'$.note'),json_extract(?1,'$.createdAt')"#)
      .bind(movement.to_string()).execute(&mut *tx).await.map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())
}

async fn database_pool(app: &tauri::AppHandle) -> Result<sqlx::SqlitePool, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("income-ledger.db");
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(false)
        .busy_timeout(Duration::from_secs(5))
        .journal_mode(SqliteJournalMode::Wal);
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn commit_data(app: tauri::AppHandle, data: serde_json::Value) -> Result<(), String> {
    let pool = database_pool(&app).await?;
    let result = commit_in_pool(&pool, &data).await;
    pool.close().await;
    result
}

#[tauri::command]
async fn upsert_item(app: tauri::AppHandle, record: serde_json::Value) -> Result<(), String> {
    let pool = database_pool(&app).await?;
    let result = upsert_in_pool(&pool, &record).await;
    pool.close().await;
    result
}

#[tauri::command]
async fn record_inventory_movement(
    app: tauri::AppHandle,
    record: serde_json::Value,
    movement: serde_json::Value,
    sold_record: Option<serde_json::Value>,
) -> Result<(), String> {
    let pool = database_pool(&app).await?;
    let result =
        record_inventory_movement_in_pool(&pool, &record, &movement, sold_record.as_ref()).await;
    pool.close().await;
    result
}

fn validate_ids(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() || ids.iter().any(|id| id.trim().is_empty()) {
        Err("至少提供一条有效记录 ID".into())
    } else {
        Ok(())
    }
}

#[tauri::command]
async fn change_item_categories(
    app: tauri::AppHandle,
    ids: Vec<String>,
    category: String,
) -> Result<(), String> {
    validate_ids(&ids)?;
    if category.trim().is_empty() {
        return Err("分类不能为空".into());
    }
    let pool = database_pool(&app).await?;
    let result =
        sqlx::query("UPDATE items SET category=? WHERE id IN (SELECT value FROM json_each(?))")
            .bind(category)
            .bind(serde_json::to_string(&ids).map_err(|error| error.to_string())?)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|error| error.to_string());
    pool.close().await;
    result
}

#[tauri::command]
async fn set_items_deleted(
    app: tauri::AppHandle,
    ids: Vec<String>,
    deleted_at: Option<i64>,
) -> Result<(), String> {
    validate_ids(&ids)?;
    if deleted_at.is_some_and(|value| value < 0) {
        return Err("删除时间无效".into());
    }
    let pool = database_pool(&app).await?;
    let result =
        sqlx::query("UPDATE items SET deleted_at=? WHERE id IN (SELECT value FROM json_each(?))")
            .bind(deleted_at)
            .bind(serde_json::to_string(&ids).map_err(|error| error.to_string())?)
            .execute(&pool)
            .await
            .map(|_| ())
            .map_err(|error| error.to_string());
    pool.close().await;
    result
}

#[tauri::command]
async fn permanently_delete_items(
    app: tauri::AppHandle,
    ids: Option<Vec<String>>,
) -> Result<(), String> {
    if let Some(ids) = &ids {
        validate_ids(ids)?;
    }
    let pool = database_pool(&app).await?;
    let result = match ids {
    Some(ids) => sqlx::query("DELETE FROM items WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NOT NULL")
      .bind(serde_json::to_string(&ids).map_err(|error| error.to_string())?).execute(&pool).await,
    None => sqlx::query("DELETE FROM items WHERE deleted_at IS NOT NULL").execute(&pool).await,
  }.map(|_| ()).map_err(|error| error.to_string());
    pool.close().await;
    result
}

#[cfg(test)]
mod tests {
    use super::{
        migrations, MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4, MIGRATION_5, MIGRATION_6,
    };
    use futures_core::future::BoxFuture;
    use serde_json::json;
    use sqlx::Row;
    use sqlx::{
        error::BoxDynError,
        migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator},
    };
    use tauri_plugin_sql::{Migration, MigrationKind};

    #[derive(Debug)]
    struct PluginCompatibleMigrationSource(Vec<Migration>);

    impl MigrationSource<'static> for PluginCompatibleMigrationSource {
        fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
            Box::pin(async move {
                Ok(self
                    .0
                    .into_iter()
                    .filter_map(|migration| {
                        matches!(migration.kind, MigrationKind::Up).then(|| {
                            SqlxMigration::new(
                                migration.version,
                                migration.description.into(),
                                MigrationType::ReversibleUp,
                                migration.sql.into(),
                                false,
                            )
                        })
                    })
                    .collect())
            })
        }
    }

    #[tokio::test]
    async fn failed_replacement_preserves_previous_records() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_4).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_5).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_6).execute(&pool).await.unwrap();
        let valid = json!({"items":[{"id":"original","name":"test","category":"test","purchaseCents":100,"purchaseDate":"2026-01-01","status":"in_stock","tags":[],"createdAt":1}]});
        super::commit_in_pool(&pool, &valid).await.unwrap();
        assert!(
            super::commit_in_pool(&pool, &json!({"items":[{"id":"bad"}]}))
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE id='original'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn migrates_decimal_money_to_integer_cents() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO items(id,name,category,purchase,purchase_date,status,sale,shipping,platform_fee,other_fee,sale_date,note,created_at) VALUES('1','测试','鞋',0.1,'2026-01-01','sold',0.3,0.1,0.02,0.03,'2026-01-02','',1)")
      .execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        let row = sqlx::query("SELECT purchase_cents,sale_cents,shipping_cents,platform_fee_cents,other_fee_cents FROM items WHERE id='1'")
      .fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<i64, _>("purchase_cents"), 10);
        assert_eq!(row.get::<i64, _>("sale_cents"), 30);
        assert_eq!(row.get::<i64, _>("shipping_cents"), 10);
        assert_eq!(row.get::<i64, _>("platform_fee_cents"), 2);
        assert_eq!(row.get::<i64, _>("other_fee_cents"), 3);
        let quantity: i64 = sqlx::query_scalar("SELECT quantity FROM items WHERE id='1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(quantity, 1);
    }

    #[tokio::test]
    async fn failed_settings_commit_preserves_previous_categories() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO categories(name,created_at) VALUES('原分类', 1)")
            .execute(&pool)
            .await
            .unwrap();
        let invalid = json!({
          "categories": ["新分类"],
          "templates": [{ "id": "incomplete" }]
        });
        assert!(super::commit_in_pool(&pool, &invalid).await.is_err());
        let categories: Vec<String> =
            sqlx::query_scalar("SELECT name FROM categories ORDER BY name")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(categories.contains(&"原分类".to_string()));
        assert!(!categories.contains(&"新分类".to_string()));
    }

    #[tokio::test]
    async fn image_writes_preserve_missing_fields_clear_null_and_sync_collections() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_5).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_6).execute(&pool).await.unwrap();
        let base = json!({
          "id":"pictured", "name":"带图商品", "category":"鞋", "purchaseCents":100,
          "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        let mut pictured = base.clone();
        pictured
            .as_object_mut()
            .unwrap()
            .insert("imageData".into(), json!("data:image/png;base64,aW1hZ2U="));
        super::commit_in_pool(&pool, &json!({"items":[pictured]}))
            .await
            .unwrap();

        // 单条 upsert 缺少 imageData 键时必须保留原图。
        super::upsert_in_pool(&pool, &base).await.unwrap();
        let image: Option<String> =
            sqlx::query_scalar("SELECT image_data FROM items WHERE id='pictured'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(image.as_deref(), Some("data:image/png;base64,aW1hZ2U="));

        // 批量同步也遵循相同语义，同时删除未出现的记录并插入新记录。
        let second = json!({
          "id":"new", "name":"新商品", "category":"鞋", "purchaseCents":200,
          "purchaseDate":"2026-01-02", "status":"in_stock", "tags":[], "createdAt":2
        });
        super::commit_in_pool(&pool, &json!({"items":[base, second]}))
            .await
            .unwrap();
        let image: Option<String> =
            sqlx::query_scalar("SELECT image_data FROM items WHERE id='pictured'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(image.is_some());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);

        let mut clear = json!({
          "id":"pictured", "name":"带图商品", "category":"鞋", "purchaseCents":100,
          "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        clear
            .as_object_mut()
            .unwrap()
            .insert("imageData".into(), serde_json::Value::Null);
        super::upsert_in_pool(&pool, &clear).await.unwrap();
        let image: Option<String> =
            sqlx::query_scalar("SELECT image_data FROM items WHERE id='pictured'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(image, None);

        super::commit_in_pool(&pool, &json!({"items":[clear]}))
            .await
            .unwrap();
        let remaining: Vec<String> = sqlx::query_scalar("SELECT id FROM items ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, vec!["pictured"]);
    }

    #[test]
    fn rejects_empty_categories_and_non_integer_money() {
        assert!(super::validate_commit_data(&json!({"categories": []})).is_err());
        assert!(super::validate_item(&json!({
          "id":"item", "name":"商品", "category":"鞋", "purchaseDate":"2026-01-01",
          "status":"in_stock", "purchaseCents": 12.5, "tags": [], "createdAt": 1
        }))
        .is_err());
        assert!(super::validate_commit_data(&json!({"items": []})).is_err());
        assert!(super::validate_item(&json!({
          "id":"item", "name":"商品", "category":"鞋", "purchaseDate":"2026-01-01",
          "status":"in_stock", "purchaseCents": 1, "tags": [], "createdAt": 1,
          "imageData":"not-an-image"
        }))
        .is_err());
    }

    #[test]
    fn historical_migration_matches_the_shared_default_categories() {
        let categories: Vec<String> =
            serde_json::from_str(include_str!("../../src/defaultCategories.json")).unwrap();
        for category in categories {
            assert!(MIGRATION_2.contains(&format!("('{}'", category)));
        }
    }

    #[tokio::test]
    async fn plugin_compatible_migrator_records_versions_and_rejects_changed_sql() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let migrator = Migrator::new(PluginCompatibleMigrationSource(migrations()))
            .await
            .unwrap();
        migrator.run(&pool).await.unwrap();
        let versions: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6]);
        migrator.run(&pool).await.unwrap();
        let mut changed = migrations();
        changed[1].sql = "SELECT 1;";
        let changed_migrator = Migrator::new(PluginCompatibleMigrationSource(changed))
            .await
            .unwrap();
        assert!(changed_migrator.run(&pool).await.is_err());
    }

    #[tokio::test]
    async fn inventory_migration_creates_an_auditable_movement_table() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_4).execute(&pool).await.unwrap();

        sqlx::query("INSERT INTO inventory_movements(id,item_id,kind,quantity_delta,quantity_before,quantity_after,unit_cents,shipping_mode,platform_fee_mode,other_fee_mode,created_at) VALUES('movement-1','item-1','stock_in',3,1,4,1000,'per_unit','percent','per_order',1)")
      .execute(&pool).await.unwrap();
        let row: (i64, i64, String) = sqlx::query_as("SELECT quantity_before, quantity_after, kind FROM inventory_movements WHERE id = 'movement-1'")
      .fetch_one(&pool).await.unwrap();
        assert_eq!(row, (1, 4, "stock_in".to_string()));
    }

    #[tokio::test]
    async fn inventory_adjustment_updates_quantity_and_log_together() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::raw_sql(MIGRATION_1).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_2).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_3).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_5).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_6).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_4).execute(&pool).await.unwrap();
        let original = json!({
          "id":"stock-item", "name":"库存商品", "category":"鞋", "purchaseCents":100,
          "quantity":1, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        super::upsert_in_pool(&pool, &original).await.unwrap();
        let updated = json!({
          "id":"stock-item", "name":"库存商品", "category":"鞋", "purchaseCents":100,
          "quantity":3, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        let movement = json!({
          "id":"stock-movement", "itemId":"stock-item", "kind":"stock_in",
          "quantityDelta":2, "quantityBefore":1, "quantityAfter":3, "unitCents":100,
          "shippingCents":0, "platformFeeValue":0, "otherFeeCents":0, "createdAt":2
        });
        super::record_inventory_movement_in_pool(&pool, &updated, &movement, None)
            .await
            .unwrap();
        let quantity: i64 = sqlx::query_scalar("SELECT quantity FROM items WHERE id='stock-item'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let movements: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM inventory_movements WHERE item_id='stock-item'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!((quantity, movements), (3, 1));
    }

    #[tokio::test]
    async fn partial_sale_keeps_remaining_stock_and_creates_a_sold_record() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in [
            MIGRATION_1,
            MIGRATION_2,
            MIGRATION_3,
            MIGRATION_4,
            MIGRATION_5,
            MIGRATION_6,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        let original = json!({
          "id":"stock-item", "name":"库存商品", "category":"鞋", "purchaseCents":100,
          "quantity":4, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        super::upsert_in_pool(&pool, &original).await.unwrap();
        let remaining = json!({
          "id":"stock-item", "name":"库存商品", "category":"鞋", "purchaseCents":100,
          "quantity":2, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        let sold = json!({
          "id":"sold-item", "name":"库存商品", "category":"鞋", "purchaseCents":100,
          "quantity":2, "purchaseDate":"2026-01-01", "status":"sold", "saleCents":500,
          "saleDate":"2026-01-02", "tags":[], "createdAt":2
        });
        let movement = json!({
          "id":"sale-movement", "itemId":"stock-item", "kind":"partial_sale",
          "quantityDelta":-2, "quantityBefore":4, "quantityAfter":2, "unitCents":100,
          "shippingCents":0, "platformFeeValue":0, "otherFeeCents":0, "createdAt":2
        });
        super::record_inventory_movement_in_pool(&pool, &remaining, &movement, Some(&sold))
            .await
            .unwrap();
        let rows: Vec<(String, i64, String)> =
            sqlx::query_as("SELECT id, quantity, status FROM items ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            rows,
            vec![
                ("sold-item".into(), 2, "sold".into()),
                ("stock-item".into(), 2, "in_stock".into())
            ]
        );
    }

    #[tokio::test]
    async fn complete_backup_restore_replaces_inventory_history_with_items() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in [
            MIGRATION_1,
            MIGRATION_2,
            MIGRATION_3,
            MIGRATION_4,
            MIGRATION_5,
            MIGRATION_6,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO inventory_movements(id,item_id,kind,quantity_delta,quantity_before,quantity_after,shipping_cents,platform_fee_value,other_fee_cents,created_at) VALUES('old','removed','adjustment',1,1,2,0,0,0,1)")
            .execute(&pool).await.unwrap();
        let backup = json!({
          "items": [{
            "id":"backup-item", "name":"备份商品", "category":"鞋", "purchaseCents":100,
            "quantity":3, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
          }],
          "inventoryMovements": [{
            "id":"backup-movement", "itemId":"backup-item", "kind":"stock_in",
            "quantityDelta":2, "quantityBefore":1, "quantityAfter":3, "shippingCents":0,
            "platformFeeValue":0, "otherFeeCents":0, "createdAt":2
          }]
        });
        super::commit_in_pool(&pool, &backup).await.unwrap();
        let item_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE id='backup-item'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let history: Vec<String> =
            sqlx::query_scalar("SELECT id FROM inventory_movements ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(item_count, 1);
        assert_eq!(history, vec!["backup-movement"]);
    }

    #[tokio::test]
    async fn missing_quantity_preserves_existing_inventory_quantity() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in [
            MIGRATION_1,
            MIGRATION_2,
            MIGRATION_3,
            MIGRATION_4,
            MIGRATION_5,
            MIGRATION_6,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        let full = json!({
          "id":"quantity-item", "name":"数量商品", "category":"鞋", "purchaseCents":100,
          "quantity":3, "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        super::upsert_in_pool(&pool, &full).await.unwrap();
        let missing_quantity = json!({
          "id":"quantity-item", "name":"更新后的数量商品", "category":"鞋", "purchaseCents":100,
          "purchaseDate":"2026-01-01", "status":"in_stock", "tags":[], "createdAt":1
        });
        super::upsert_in_pool(&pool, &missing_quantity)
            .await
            .unwrap();
        let quantity: i64 =
            sqlx::query_scalar("SELECT quantity FROM items WHERE id='quantity-item'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(quantity, 3);
    }
    #[tokio::test]
    async fn reconciliation_migration_preserves_receipts_and_restores_reason_atomically() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in [
            MIGRATION_1,
            MIGRATION_2,
            MIGRATION_3,
            MIGRATION_4,
            MIGRATION_5,
        ] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO items(id,name,category,purchase_cents,quantity,purchase_date,status,sale_cents,platform_fee_cents,sale_date,payment_status,received_cents,received_date,tags_json,created_at) VALUES('paid','已到账','鞋',40000,1,'2026-10-13','sold',45000,1000,'2026-10-18','received',43000,'2026-10-23','[]',1)").execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_6).execute(&pool).await.unwrap();
        let row = sqlx::query("SELECT payment_status,received_cents,received_date,settlement_expected_cents,settlement_reason FROM items WHERE id='paid'").fetch_one(&pool).await.unwrap();
        assert_eq!(row.get::<String, _>("payment_status"), "received");
        assert_eq!(row.get::<i64, _>("received_cents"), 43000);
        assert_eq!(row.get::<String, _>("received_date"), "2026-10-23");
        assert!(row
            .get::<Option<i64>, _>("settlement_expected_cents")
            .is_none());
        assert!(row.get::<Option<String>, _>("settlement_reason").is_none());
        let paid = json!({"id":"paid","name":"已到账","category":"鞋","purchaseCents":40000,"quantity":1,"purchaseDate":"2026-10-13","status":"sold","saleCents":45000,"platformFeeCents":1000,"saleDate":"2026-10-18","paymentStatus":"received","receivedDate":"2026-10-23","receivedCents":43000,"settlementExpectedCents":44000,"settlementReason":"额外结算费10元","tags":[],"createdAt":1});
        super::upsert_in_pool(&pool, &paid).await.unwrap();
        let row = sqlx::query(
            "SELECT settlement_expected_cents,settlement_reason FROM items WHERE id='paid'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<i64, _>("settlement_expected_cents"), 44000);
        assert_eq!(row.get::<String, _>("settlement_reason"), "额外结算费10元");
        // 完整恢复和逐笔更新共用写入路径；验证恢复保留核对信息。
        super::commit_in_pool(&pool, &json!({"items":[paid]}))
            .await
            .unwrap();
        let reason: String =
            sqlx::query_scalar("SELECT settlement_reason FROM items WHERE id='paid'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(reason, "额外结算费10元");
        let state = json!({"capitalLimitCents":800000,"afterSales":[]});
        super::commit_in_pool(&pool, &json!({"finance":state}))
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TRIGGER reject_reconciliation_finance BEFORE UPDATE ON ledger_finance BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").execute(&pool).await.unwrap();
        let mut edited = paid.clone();
        edited["settlementReason"] = json!("不应保存的原因");
        assert!(
            super::commit_in_pool(&pool, &json!({"itemUpdates":[edited],"finance":state}))
                .await
                .is_err()
        );
        let reason: String =
            sqlx::query_scalar("SELECT settlement_reason FROM items WHERE id='paid'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(reason, "额外结算费10元");
        let mut invalid = paid.clone();
        invalid["settlementExpectedCents"] = json!(-1);
        assert!(super::upsert_in_pool(&pool, &invalid).await.is_err());
        invalid = paid.clone();
        invalid["settlementReason"] = json!(42);
        assert!(super::upsert_in_pool(&pool, &invalid).await.is_err());
        invalid = paid.clone();
        invalid["paymentStatus"] = json!("pending");
        invalid.as_object_mut().unwrap().remove("receivedCents");
        invalid.as_object_mut().unwrap().remove("receivedDate");
        assert!(super::upsert_in_pool(&pool, &invalid).await.is_err());
    }

    #[tokio::test]
    async fn receipts_migrate_without_inventing_dates_and_finance_rolls_back_with_stock() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in [MIGRATION_1, MIGRATION_2, MIGRATION_3, MIGRATION_4] {
            sqlx::raw_sql(migration).execute(&pool).await.unwrap();
        }
        sqlx::query("INSERT INTO items(id,name,category,purchase_cents,purchase_date,status,sale_cents,sale_date,tags_json,created_at) VALUES('old','旧交易','鞋',40000,'2026-10-13','sold',45000,'2026-10-18','[]',1)").execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_5).execute(&pool).await.unwrap();
        sqlx::raw_sql(MIGRATION_6).execute(&pool).await.unwrap();
        let row = sqlx::query(
            "SELECT payment_status,received_date,received_cents FROM items WHERE id='old'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<String, _>("payment_status"), "historical");
        assert!(row.get::<Option<String>, _>("received_date").is_none());
        assert!(row.get::<Option<i64>, _>("received_cents").is_none());
        let paid = json!({"id":"old","name":"旧交易","category":"鞋","purchaseCents":40000,"purchaseDate":"2026-10-13","status":"sold","saleCents":45000,"saleDate":"2026-10-18","paymentStatus":"received","receivedDate":"2026-10-23","receivedCents":44000,"tags":[],"createdAt":1});
        super::upsert_in_pool(&pool, &paid).await.unwrap();
        let received: i64 = sqlx::query_scalar("SELECT received_cents FROM items WHERE id='old'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(received, 44000);
        let state = json!({"capitalLimitCents":800000,"afterSales":[]});
        super::commit_in_pool(&pool, &json!({"finance":state}))
            .await
            .unwrap();
        sqlx::raw_sql("CREATE TRIGGER reject_finance BEFORE UPDATE ON ledger_finance BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").execute(&pool).await.unwrap();
        let returned = json!({"id":"return","name":"退回商品","category":"鞋","purchaseCents":40000,"quantity":1,"purchaseDate":"2026-10-13","status":"in_stock","tags":[],"createdAt":2});
        assert!(
            super::commit_in_pool(&pool, &json!({"itemUpdates":[returned],"finance":state}))
                .await
                .is_err()
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE id='return'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM items WHERE id='old'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
}
