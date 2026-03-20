//! JSON-shaped user-facing messages for Tauri `invoke` and sync protocol.
//! Frontend parses `{"code":"...","params":{...}}` and translates via i18n.

use serde_json::{Map, Value};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct UserMsg {
    pub code: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub params: Map<String, Value>,
}

impl UserMsg {
    pub fn new(code: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            params: Map::new(),
        }
    }

    pub fn with_param(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.params
            .insert(key.into(), Value::String(value.into()));
        self
    }

    pub fn with_param_i64(mut self, key: impl Into<String>, value: i64) -> Self {
        self.params.insert(key.into(), Value::Number(value.into()));
        self
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| r#"{"code":"unknown"}"#.to_string())
    }
}

pub fn user_msg(code: impl Into<String>) -> String {
    UserMsg::new(code).to_json()
}

pub fn user_msg_str(code: impl Into<String>, key: &str, value: impl Into<String>) -> String {
    UserMsg::new(code)
        .with_param(key, value)
        .to_json()
}
