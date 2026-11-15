//! Published editor schemas for version 1 of the workspace formats.
//!
//! Generate from the deserialization contract, including optional fields and
//! Serde's enum representations. These describe individual files; compilation
//! still checks graph structure, references and cross-file compatibility.

use std::collections::BTreeMap;

use schemars::{generate::SchemaSettings, JsonSchema, Schema};

use super::{Bundle, Manifest};
use crate::authorization::{AuthzCatalog, PolicyDocument, MAX_POLICIES};
use crate::domain::TopologySpec;
use crate::incidents::recordings::Recording;
use crate::incidents::ScenarioDef;

fn schema<T: JsonSchema>(name: &str) -> Schema {
    // Draft 7 works in editors and validators without loading any remote refs.
    let mut schema = SchemaSettings::draft07()
        .into_generator()
        .into_root_schema_for::<T>();
    schema.insert(
        "$id".into(),
        format!(
            "https://raw.githubusercontent.com/cleissonbarbosa/csdt/main/schemas/v1/{name}.schema.json"
        )
        .into(),
    );
    schema
}

/// File names and schemas, in deterministic order. No I/O.
pub fn documents() -> BTreeMap<&'static str, Schema> {
    let mut policies = schema::<Vec<PolicyDocument>>("policies");
    policies.insert("maxItems".into(), MAX_POLICIES.into());
    BTreeMap::from([
        ("workspace", schema::<Manifest>("workspace")),
        ("bundle", schema::<Bundle>("bundle")),
        ("topology", schema::<TopologySpec>("topology")),
        ("scenario", schema::<ScenarioDef>("scenario")),
        ("recording", schema::<Recording>("recording")),
        ("catalog", schema::<AuthzCatalog>("catalog")),
        ("policies", policies),
    ])
}
