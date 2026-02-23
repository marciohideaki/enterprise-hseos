# Data Governance & LGPD Standard
## Cross-Cutting — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — mandatory for all services processing data
**Classification:** Cross-Cutting (Mandatory)
**Authority:** LGPD (Lei 13.709/2018), GDPR (where applicable)

> This standard defines **mandatory** data governance rules for all services that store, process, transmit or expose data.
> It covers data classification, PII handling, retention, LGPD compliance, lineage and quality.
> Every rule is normative. Exceptions require an approved ADR in `.specs/decisions/`.

---

## 1. Data Classification

### 1.1 Classification Levels

- DG-01: **Every field, column, event attribute, and API response property MUST carry an explicit data classification.** Unclassified data is treated as Confidential until reclassified.

- DG-02: The four mandatory classification levels are, in ascending sensitivity order:

  | Level | Code | Description |
  |---|---|---|
  | Public | `PUBLIC` | Data intended for unrestricted public consumption. No access control required. |
  | Internal | `INTERNAL` | Data for internal use only. Not for external audiences. Low risk if exposed, but should not be published. |
  | Confidential | `CONFIDENTIAL` | Business-sensitive data. Exposure causes reputational or competitive harm. Requires access control and encryption at rest. |
  | PII / Sensitive | `PII` | Personal data as defined by LGPD Art. 5 and sensitive personal data as defined by LGPD Art. 11. Highest protection requirements. |

- DG-03: Classification must be applied at the **lowest granular level possible** — field by field, not table by table. A table with one PII field is a PII table.

- DG-04: Classification must be machine-readable where the stack supports it. Use annotations, attributes, tags or schema metadata as specified per stack below.

- DG-05: Downgrading a classification (e.g., PII to Internal) requires an ADR approved by the DPO.

### 1.2 Classification Examples by Level

**PUBLIC examples:**
- Product names, public prices, public marketing content
- Publicly available documentation URLs
- Country names, ISO currency codes, open API reference data

**INTERNAL examples:**
- Internal employee IDs (non-identifying serial numbers)
- Internal cost center codes
- Aggregated, anonymized business metrics (e.g., "total orders this month: 4,200")
- Internal service configuration keys (non-secret)

**CONFIDENTIAL examples:**
- Business contracts, SLA terms, pricing agreements
- Non-public financial reports
- Proprietary algorithm parameters
- Customer account balance aggregations without individual breakdown
- Employee salary bands

**PII / SENSITIVE examples:**
- Full name, CPF, RG, CNPJ (of natural persons), passport number
- Email address, phone number, home address, postal code combined with name
- Device IP address, cookie identifier, device fingerprint
- Biometric data (fingerprint hash, face recognition data)
- Health records, medical diagnoses, prescription data
- Religious beliefs, political opinions, union membership
- Sexual orientation or gender identity
- Financial account numbers, credit card numbers, bank transactions linked to a person
- Precise GPS coordinates or movement history linked to a person

### 1.3 Stack-Specific Classification Annotations

- DG-06: **C# / .NET** — use the `[DataClassification]` attribute from a shared governance library. Every entity property and DTO property must carry it:

```csharp
// DG-04 — explicit field-level classification required
public class CustomerEntity
{
    [DataClassification(Level.Internal)]
    public Guid Id { get; set; }

    [DataClassification(Level.PII)]
    public string FullName { get; set; } = default!;

    [DataClassification(Level.PII)]
    public string TaxId { get; set; } = default!;   // CPF

    [DataClassification(Level.PII)]
    public string Email { get; set; } = default!;

    [DataClassification(Level.Confidential)]
    public decimal AccountBalance { get; set; }

    [DataClassification(Level.Public)]
    public string CountryCode { get; set; } = default!;
}
```

- DG-07: **Java / Spring** — use a custom `@DataClassification` annotation:

```java
// DG-04 — explicit field-level classification required
public class CustomerEntity {

    @DataClassification(Level.INTERNAL)
    private UUID id;

    @DataClassification(Level.PII)
    private String fullName;

    @DataClassification(Level.PII)
    private String taxId;          // CPF

    @DataClassification(Level.PII)
    private String email;

    @DataClassification(Level.CONFIDENTIAL)
    private BigDecimal accountBalance;

    @DataClassification(Level.PUBLIC)
    private String countryCode;
}
```

- DG-08: **Go** — use struct tags:

```go
// DG-04 — explicit field-level classification required
type Customer struct {
    ID             uuid.UUID `json:"id"             data-classification:"INTERNAL"`
    FullName       string    `json:"fullName"        data-classification:"PII"`
    TaxID          string    `json:"taxId"           data-classification:"PII"`
    Email          string    `json:"email"           data-classification:"PII"`
    AccountBalance float64   `json:"accountBalance"  data-classification:"CONFIDENTIAL"`
    CountryCode    string    `json:"countryCode"     data-classification:"PUBLIC"`
}
```

- DG-09: **Database columns** — classification must be documented in the migration comment and in `data-lineage.md`. For PostgreSQL:

```sql
-- DG-04 — column-level classification via comments
COMMENT ON COLUMN customers.full_name IS 'classification:PII — LGPD Art.5 I';
COMMENT ON COLUMN customers.tax_id    IS 'classification:PII — CPF, LGPD Art.5 I';
COMMENT ON COLUMN customers.email     IS 'classification:PII — LGPD Art.5 I';
COMMENT ON COLUMN customers.balance   IS 'classification:CONFIDENTIAL';
```

- DG-10: **Event payloads** — every event schema (Avro, JSON Schema, Protobuf) must include a `dataClassification` field at the envelope level, and individual fields must carry classification metadata in their description/doc attribute:

```json
{
  "$schema": "...",
  "title": "OrderPlaced",
  "x-data-classification": "PII",
  "properties": {
    "orderId":      { "type": "string", "x-classification": "INTERNAL" },
    "customerEmail":{ "type": "string", "x-classification": "PII" },
    "totalAmount":  { "type": "number", "x-classification": "CONFIDENTIAL" }
  }
}
```

---

## 2. PII — Definition and Inventory

### 2.1 PII Definition (LGPD Art. 5)

- DG-11: **Personal data** (dado pessoal) is any information relating to an identified or identifiable natural person (LGPD Art. 5, I). A person is identifiable if they can be directly or indirectly identified, in particular by reference to an identifier.

- DG-12: **Sensitive personal data** (dado pessoal sensível) includes data on racial or ethnic origin, religious conviction, political opinion, union membership, data relating to health or sex life, genetic or biometric data, when linked to a natural person (LGPD Art. 5, II). Sensitive personal data requires a stricter legal basis (LGPD Art. 11) and the highest protection controls.

- DG-13: **The following data types are unconditionally classified as PII** in this standard. Any service touching one or more of these fields is a PII-processing service and all DG-21 through DG-55 rules apply:

  | Category | Examples |
  |---|---|
  | Direct identifiers | Full name, CPF, RG, CNH number, passport number, birth certificate number |
  | Contact information | Personal email address, mobile phone number, residential address, postal code combined with name |
  | Online identifiers | IP address (IPv4 and IPv6), cookie ID, device fingerprint, browser session ID, advertising ID (IDFA/GAID) |
  | Biometric data | Fingerprint hash, facial recognition embedding, voiceprint, iris scan data |
  | Health data | Medical diagnoses, prescriptions, health insurance number, disability data, hospitalization records |
  | Financial data | Bank account number, credit/debit card number (even masked), PIX key linked to person, individual transaction history |
  | Location data | GPS coordinates with timestamp linked to a person, movement history, home/work location |
  | Sensitive categories | Religious belief, political affiliation, union membership, sexual orientation, gender identity, ethnic origin |
  | Derived/inferred | Credit score linked to person, behavioral profile, purchase history linked to person |

- DG-14: **Pseudonymized data is still PII** if re-identification is possible with additional data held by the controller or by a third party. Truly anonymized data — where re-identification is not reasonably possible — is not PII, but must be documented in the `data-lineage.md` with the anonymization technique used.

### 2.2 PII Data Inventory

- DG-15: **Every service that processes PII must maintain a `data-inventory.md`** file in its repository root (or documentation directory). This file is mandatory and must be kept current. It must contain, at minimum:

  ```markdown
  # Data Inventory — [Service Name]

  **Owner:** [Team name]
  **DPO Review Date:** [YYYY-MM-DD]
  **Last Updated:** [YYYY-MM-DD]

  ## PII Fields Processed

  | Field | Classification | Legal Basis | Retention | Storage Location | Encrypted at Rest |
  |---|---|---|---|---|---|
  | customers.full_name | PII | Contract (LGPD Art.7 V) | Active + 5y | PostgreSQL | AES-256 |
  | customers.email | PII | Contract (LGPD Art.7 V) | Active + 5y | PostgreSQL | AES-256 |
  | customers.tax_id | PII | Legal obligation (LGPD Art.7 II) | 5y post-closure | PostgreSQL (encrypted column) | AES-256 |
  | events.customer_ip | PII | Legitimate interest (LGPD Art.7 IX) | 90 days | Elasticsearch | TLS in transit |
  ```

- DG-16: **The `data-inventory.md` must be reviewed and signed off by the DPO** before a service goes to production if it processes PII. The DPO sign-off date must be recorded in the file.

- DG-17: **PII fields must never appear in log messages, distributed traces, or metrics.** This rule has no exceptions. If a field is classified PII, it must be masked, tokenized, or omitted before any observability emission. See DG-21 through DG-25 for required techniques.

- DG-18: **PII must not be included in error messages** returned to clients or written to error tracking systems (e.g., Sentry, Datadog Error Tracking) in raw form. Use tokens or masked representations only.

- DG-19: **PII must not appear in URL paths or query strings** that may be logged by proxies, load balancers, or CDNs. Use POST bodies or headers with explicit log-exclusion configuration.

- DG-20: **Each PII field must have exactly one declared primary storage location.** Replication to secondary systems (caches, data warehouses, search indexes) must be documented in `data-lineage.md` and each secondary location must implement the same or stricter controls as the primary.

---

## 3. PII Treatment in Code

### 3.1 Mandatory Masking in Logs

- DG-21: **All PII fields must be masked before being written to any log output.** The masking must be applied at the logging layer, not at call sites, to prevent accidental leakage from new code.

  Required masking formats by field type:

  | Field Type | Raw Value | Masked Output |
  |---|---|---|
  | CPF | `123.456.789-09` | `***.***.***-**` |
  | CNPJ (pessoa física context) | `12.345.678/0001-90` | `**.***.***/**-**` |
  | Email | `usuario@dominio.com` | `u***@d***.com` |
  | Phone | `+55 11 91234-5678` | `+55 ** *****-****` |
  | Full name | `João Silva` | `J*** S***` |
  | IP address | `192.168.10.42` | `192.168.***.***` |
  | Credit card | `4111111111111111` | `****-****-****-1111` |
  | Bank account | `12345-6` | `*****-6` |

- DG-22: **C# masking implementation** — implement masking as a Serilog destructuring policy or a structured logging enricher:

```csharp
// DG-21 — PII masking applied at the logging layer
public static class PiiMasker
{
    // DG-21: CPF → "***.***.***-**"
    public static string MaskCpf(string cpf) =>
        "***.***.***-**";

    // DG-21: email → "u***@d***.com"
    public static string MaskEmail(string email)
    {
        if (string.IsNullOrWhiteSpace(email) || !email.Contains('@'))
            return "***@***.***";

        var parts = email.Split('@');
        var user   = parts[0].Length > 1 ? parts[0][0] + "***" : "***";
        var domain = parts[1].Contains('.')
            ? parts[1][0] + "***." + parts[1].Split('.').Last()
            : "***";
        return $"{user}@{domain}";
    }

    // DG-21: phone → "+55 ** *****-****"
    public static string MaskPhone(string phone) =>
        System.Text.RegularExpressions.Regex.Replace(phone, @"\d", "*",
            System.Text.RegularExpressions.RegexOptions.None, TimeSpan.FromMilliseconds(100))
            .Replace("*", "*"); // simplified; implement with positional rules
}

// DG-22 — usage in application code
_logger.LogInformation(
    "Order {OrderId} created for customer {MaskedEmail}",
    orderId,
    PiiMasker.MaskEmail(customer.Email));  // DG-21: never log raw email
```

- DG-23: **Java masking implementation**:

```java
// DG-21 — PII masking applied before any log emission
public final class PiiMasker {

    private PiiMasker() {}

    // DG-21: CPF → "***.***.***-**"
    public static String maskCpf(String cpf) {
        return "***.***.***-**";
    }

    // DG-21: email → "u***@d***.com"
    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) return "***@***.***";
        String[] parts = email.split("@", 2);
        String user   = parts[0].length() > 1 ? parts[0].charAt(0) + "***" : "***";
        String[] dom  = parts[1].split("\\.", 2);
        String domain = dom.length > 1 ? dom[0].charAt(0) + "***." + dom[1] : "***";
        return user + "@" + domain;
    }
}

// DG-23 — usage
log.info("Order {} created for customer {}",
    orderId,
    PiiMasker.maskEmail(customer.getEmail())); // DG-21: never log raw email
```

- DG-24: **Go masking implementation**:

```go
// DG-21 — PII masking before log emission
package pii

import "strings"

// DG-21: MaskCPF → "***.***.***-**"
func MaskCPF(_ string) string { return "***.***.***-**" }

// DG-21: MaskEmail → "u***@d***.com"
func MaskEmail(email string) string {
    idx := strings.Index(email, "@")
    if idx < 1 { return "***@***.***" }
    user   := string(email[0]) + "***"
    rest   := email[idx+1:]
    dot    := strings.LastIndex(rest, ".")
    domain := string(rest[0]) + "***"
    if dot > 0 { domain += rest[dot:] }
    return user + "@" + domain
}

// DG-24 — usage
logger.Info("order created",
    slog.String("orderId",      order.ID.String()),
    slog.String("maskedEmail",  pii.MaskEmail(customer.Email)), // DG-21
)
```

### 3.2 Tokenization

- DG-25: **Tokenization is mandatory when PII must be stored in analytics systems, data warehouses, BI tools, or event streaming platforms** where the raw value is not required for the analytical purpose. A token is an opaque, reversible reference to the PII stored in a dedicated token vault.

  Rules for tokenization:
  - The token vault is the sole authoritative store of the PII ↔ token mapping.
  - Tokens must be format-preserving (same structure as the original) or opaque UUIDs.
  - Token vault access requires explicit authorization; read access to the vault is logged (DG-62).
  - Detokenization must only occur in authorized services; it must never occur in reporting or BI layers.

### 3.3 Irreversible Hashing

- DG-26: **Hashing (SHA-256 + salt) must be used when PII is needed for matching or deduplication, but the original value must not be recoverable.** Common cases: blacklist checks, deduplication pipelines, cohort analysis.

```csharp
// DG-26 — irreversible hashing with per-record salt
// DO NOT use MD5 or SHA-1 — they are forbidden for PII (DG-26)
public static string HashPii(string value, string salt)
{
    using var sha256 = System.Security.Cryptography.SHA256.Create();
    var bytes = System.Text.Encoding.UTF8.GetBytes(salt + value);
    var hash  = sha256.ComputeHash(bytes);
    return Convert.ToHexString(hash).ToLowerInvariant();
}
// DG-26: salt must be unique per record (stored alongside the hash),
// NOT a global application secret — otherwise a compromised secret
// breaks all hashes at once.
```

- DG-27: **MD5, SHA-1 and unsalted hashes are forbidden for PII.** Any existing usage must be migrated. Migration requires an ADR with timeline.

### 3.4 Encryption at Rest

- DG-28: **Confidential and PII fields must be encrypted at rest using AES-256 (minimum).** Accepted implementations:
  - Transparent Data Encryption (TDE) at the database engine level, or
  - Column-level / field-level encryption using AES-256-GCM at the application layer (preferred for PII because it protects against DBA access).
  - Cloud-provider managed encryption (e.g., AWS KMS, Azure Key Vault, GCP CMEK) is acceptable if the key is customer-managed (CMEK), not provider-managed.

- DG-29: **Encryption keys must not be stored in the same system as the encrypted data.** Keys must be stored in a dedicated key management system (KMS) and rotated at least annually. Key rotation events must be logged.

### 3.5 Encryption in Transit

- DG-30: **TLS 1.2 is the minimum for all data in transit. TLS 1.3 is the required standard for all new services.** SSL 3.0, TLS 1.0, and TLS 1.1 are forbidden. Services must refuse downgrade negotiation. Mutual TLS (mTLS) is required for service-to-service calls that transmit PII.

---

## 4. Retention and Deletion

### 4.1 Retention Periods

- DG-31: **Retention periods by data category are mandatory defaults.** Teams may define stricter (shorter) retention with DPO approval. Extending retention beyond these defaults requires an ADR with a stated legal basis:

  | Data Category | Default Retention | Authority |
  |---|---|---|
  | Application logs (all levels) | 90 days | Operational need; no legal basis for longer without justification |
  | Distributed traces | 30 days | Operational need |
  | Infrastructure metrics (aggregated) | 13 months | Trend analysis, capacity planning |
  | Audit logs (access to PII, security events) | 5 years | LGPD Art. 37; legal obligation |
  | Transactional / financial records | 5 years after transaction | Lei 9.613/1998, Receita Federal obligations |
  | Contractual data | 5 years after contract end | Código Civil Art. 206 |
  | User account PII (active users) | While account is active + 5 years after closure | LGPD Art. 16; legal obligation basis |
  | User account PII (inactive / deleted) | 5 years after deletion request, then hard delete | LGPD Art. 16 |
  | Marketing / consent records | 5 years after last interaction or consent withdrawal | LGPD Art. 16; legal obligation |
  | Backup snapshots | Must not exceed the retention of the primary data | DG-40 |

- DG-32: **Retention periods must be enforced automatically.** Manual deletion processes are not acceptable for large data sets. Implement automated TTL policies, lifecycle rules, or scheduled deletion jobs with monitoring.

- DG-33: **Retention periods apply to all copies** — primary storage, replicas, caches, backups, data warehouse copies, and event log offsets. A field cannot be considered deleted if a copy remains beyond its retention period.

### 4.2 Hard Delete vs. Soft Delete

- DG-34: **PII fields must support hard delete.** Soft delete (setting `deleted_at`, `is_deleted`) is not sufficient for PII. The record must be either:
  - Physically deleted (`DELETE FROM`), or
  - Anonymized in place (all PII fields overwritten with `NULL` or a constant placeholder such as `[REDACTED]`), with the record retained only if a non-PII business need justifies it.

- DG-35: **If a record is anonymized in place instead of hard deleted, the anonymization must be irreversible.** The original PII must not be recoverable from backups within the retention window. This means backups taken before anonymization must be deleted or must reach their own expiry before the anonymization is considered complete.

- DG-36: **Soft delete is acceptable for non-PII fields** (e.g., `deleted_at` for product catalog items). Soft-deleted non-PII records must still be excluded from PII-bearing queries.

### 4.3 Right to Erasure (LGPD Art. 18, VI)

- DG-37: **The Right to Erasure must be implemented end-to-end within 15 business days of the verified request.** The 15-day clock starts from the moment the request is verified (identity confirmed), not from submission.

- DG-38: **Erasure must cover all systems** where the subject's PII is stored, including: primary database, read replicas, search indexes, caches, data warehouse, analytics platforms, audit logs older than the legal retention minimum, and backup snapshots beyond the legal minimum retention period.

- DG-39: **Exceptions to full erasure (LGPD Art. 16)** — PII may be retained past the erasure request only when:
  - Required to comply with a legal obligation (e.g., financial records under Lei 9.613/1998)
  - Required for the regular exercise of rights in judicial, administrative or arbitration proceedings
  The exception and its legal basis must be recorded and communicated to the data subject within the 15-day deadline.

### 4.4 Cascading Deletion via Domain Events

- DG-40: **Services must implement cascading deletion by subscribing to the `UserDataDeletionRequested` domain event.** This event is the canonical mechanism for propagating erasure requests across service boundaries.

  Required event contract:

  ```json
  {
    "eventType": "UserDataDeletionRequested",
    "version": "1.0",
    "eventId": "<uuid>",
    "occurredAt": "<ISO-8601>",
    "dataClassification": "PII",
    "processingPurpose": "RightToErasure",
    "payload": {
      "subjectId": "<internal-user-id>",
      "requestedAt": "<ISO-8601>",
      "requestId": "<uuid>",
      "legalBasis": "LGPD_Art18_VI",
      "confirmedByDpo": true,
      "deadlineAt": "<ISO-8601>"
    }
  }
  ```

  Rules:
  - Every service that holds PII linked to a `subjectId` **must subscribe** to this event.
  - Upon receiving the event, the service must initiate deletion/anonymization and emit a `UserDataDeletionCompleted` confirmation event within 24 hours.
  - Failure to process the event must trigger an alert to the owning team and the DPO channel.
  - Event processing must be idempotent (deduplicated by `requestId`).

### 4.5 Backup Retention

- DG-41: **Backup retention policies must not exceed the primary data retention period for PII.** If primary data has a 5-year retention, backups must not be kept for 7 years. The shorter window always governs.

- DG-42: **Point-in-time restore capabilities must not be used to restore deleted PII** after a verified erasure request. Restoring PII after erasure constitutes a new processing act and requires a new legal basis. Restore operations of PII data must be logged and approved by the DPO.

---

## 5. LGPD Compliance

### 5.1 Legal Basis for Processing

- DG-43: **Every processing activity involving PII must declare its legal basis** before the service goes to production. There is no default legal basis. Processing without a declared basis is a violation of LGPD Art. 7.

  Accepted legal bases under LGPD Art. 7 and their constraints:

  | Legal Basis | LGPD Reference | Allowed When | Constraints |
  |---|---|---|---|
  | Consent | Art. 7, I | User has freely given, specific, informed, unambiguous consent | Must be withdrawable at any time; record of consent required |
  | Contract performance | Art. 7, V | Processing is necessary to perform a contract to which the subject is party | Only data strictly necessary for the contract |
  | Legal obligation | Art. 7, II | Controller is required by law to process the data | Scope limited to what the law requires |
  | Vital interests | Art. 7, III | Protection of life or physical safety | Emergency use only; narrow scope |
  | Public task | Art. 7, VI | Processing by public authority | Not applicable to private sector without specific delegation |
  | Legitimate interest | Art. 7, IX | Controller or third party's legitimate interest, not overridden by subject's rights | Requires LIA (Legitimate Interest Assessment); cannot be used for sensitive data |
  | Credit protection | Art. 7, X | Credit reference and fraud prevention | Strictly scoped to credit decisions |

- DG-44: **Sensitive personal data (LGPD Art. 5, II) requires one of the stricter bases under LGPD Art. 11**, not Art. 7. The most common applicable bases for private-sector services are:
  - Specific, highlighted consent (Art. 11, I)
  - Legal or regulatory obligation (Art. 11, II, a)
  - Regular exercise of rights (Art. 11, II, d)
  - Health protection (Art. 11, II, f) — requires healthcare provider context

- DG-45: **Consent records must be stored immutably** with: the exact consent text shown, the timestamp, the user identifier, the IP address (masked after 30 days per DG-31), the version of the privacy notice accepted, and the withdrawal timestamp if applicable.

### 5.2 Record of Processing Activities (ROPA)

- DG-46: **Every service that processes PII must maintain a ROPA entry** (Record of Processing Activities). The ROPA is maintained by the DPO in the organization-level governance repository. Services contribute their entry via a `ropa-entry.md` file in the service repository.

  Required `ropa-entry.md` fields:

  ```markdown
  # ROPA Entry — [Service Name]

  **Controller:** [Legal entity name]
  **Service owner:** [Team name]
  **DPO approval date:** [YYYY-MM-DD]
  **Last review:** [YYYY-MM-DD]

  ## Processing Activities

  | Activity | Purpose | Legal Basis | Data Categories | Subjects | Retention | Recipients | International Transfer |
  |---|---|---|---|---|---|---|---|
  | Customer registration | Contract execution | Art.7 V — Contract | Name, email, CPF | Customers | Active + 5y | None | No |
  | Fraud detection | Legitimate interest | Art.7 IX — LIA ref: LIA-2024-001 | IP, device ID, transaction history | Customers | 90 days | Internal only | No |
  ```

- DG-47: **ROPA entries must be reviewed annually** and updated immediately when a new processing activity, new data category, or new recipient is added. Updates without DPO review are not valid.

### 5.3 Data Protection Impact Assessment (DPIA)

- DG-48: **A DPIA is mandatory before launching** any of the following:
  - A new service that processes PII for more than 10,000 distinct data subjects
  - Any processing that involves sensitive personal data at any scale
  - Automated profiling or scoring that produces legal or similarly significant effects
  - Any new purpose of processing for existing PII data sets (purpose limitation — LGPD Art. 6, I)
  - Cross-border transfer of PII to countries without adequate protection (ANPD adequacy list)
  - Large-scale monitoring, tracking or behavioral analysis

- DG-49: **DPIA must be documented** using the ANPD-recommended framework and stored in `.specs/decisions/dpia/` with naming `DPIA-[YYYY]-[NNN]-[service-name].md`. The DPIA must identify risks, assess their likelihood and severity, and define mitigating controls. It must be signed off by the DPO.

### 5.4 Data Subject Rights Response Timelines

- DG-50: **Data subject rights requests must be acknowledged within 1 business day** of receipt and fulfilled within the following mandatory deadlines (LGPD Art. 18):

  | Right | LGPD Reference | Deadline | Notes |
  |---|---|---|---|
  | Access (confirmation and copy of data) | Art. 18, I and II | 15 business days | Must cover all systems per DG-38 scope |
  | Correction of incomplete/inaccurate data | Art. 18, III | 15 business days | Must propagate corrections to all copies |
  | Anonymization, blocking or deletion of unnecessary data | Art. 18, IV | 15 business days | Only applies to data processed without legal basis |
  | Portability | Art. 18, V | 15 business days | Machine-readable format (JSON or CSV) required |
  | Erasure of data processed with consent | Art. 18, VI | 15 business days | See DG-37 through DG-42 |
  | Information about sharing with third parties | Art. 18, VII | 15 business days | Must reference ROPA entries |
  | Consent withdrawal | Art. 18, IX | Immediate (without delay) | Cannot be conditioned on any requirement |

- DG-51: **All data subject requests must be routed through the official DPO channel.** Direct handling by engineering teams without DPO involvement is forbidden. Engineers respond to DPO-initiated internal tickets, not directly to subjects.

- DG-52: **Fulfillment of each rights request must be logged** in an immutable audit trail with: request ID, type of right exercised, subject identifier (tokenized), request date, fulfillment date, fulfilling engineer, DPO confirming officer, and whether any exception to full fulfillment was applied with its legal basis.

### 5.5 Incident Notification

- DG-53: **A personal data breach must be reported to the ANPD within 72 hours** of the controller becoming aware of it, where the breach is likely to result in risk or harm to data subjects (LGPD Art. 48). The 72-hour clock is absolute. Uncertainty about the full scope of the breach does not pause the clock — submit an initial report and supplement it.

- DG-54: **Affected data subjects must be notified without undue delay** when the breach is likely to result in high risk to their rights and freedoms. Notification content must include: nature of the breach, categories and approximate number of records affected, contact details of the DPO, likely consequences, measures taken or proposed.

- DG-55: **Internal breach detection must be treated as a P0 incident.** The incident response runbook must include a data breach section with escalation to the DPO within 1 hour of detection. Any access to PII audit logs triggered by suspected breach investigation must itself be logged (DG-62).

---

## 6. Data Lineage and Traceability

### 6.1 Service Data Lineage Documentation

- DG-56: **Every service that processes data (any classification) must maintain a `data-lineage.md`** in its repository root. This is a mandatory artifact — services without it cannot be promoted to production.

  Mandatory template:

  ```markdown
  # Data Lineage — [Service Name]

  **Owner:** [Team name]
  **Last updated:** [YYYY-MM-DD]

  ## Data Inputs

  | Source | Data | Classification | Protocol | Frequency |
  |---|---|---|---|---|
  | customer-service (event: CustomerRegistered) | Customer PII | PII | Kafka / TLS 1.3 | Real-time |
  | order-service (REST GET /orders/{id}) | Order details | Confidential | HTTPS / mTLS | On demand |

  ## Data Stored

  | Store | Data | Classification | Retention | Encrypted at Rest | Legal Basis |
  |---|---|---|---|---|---|
  | PostgreSQL customers table | Name, email, CPF, address | PII | Active + 5y | AES-256 (TDE) | Contract Art.7 V |
  | Redis session cache | Session token (opaque) | Internal | 24h TTL | TLS in transit | Contract Art.7 V |

  ## Data Outputs

  | Destination | Data | Classification | Protocol | Purpose |
  |---|---|---|---|---|
  | notification-service (event: OrderConfirmed) | Order ID, masked email | Internal | Kafka / TLS 1.3 | Notify customer |
  | BI data warehouse | Anonymized order aggregates | Internal | JDBC / TLS 1.3 | Reporting |

  ## Anonymization / Tokenization Applied

  | Original field | Technique | Output | System |
  |---|---|---|---|
  | customers.email | Tokenization | token_id (UUID) | BI data warehouse |
  | customers.tax_id | Hash (SHA-256+salt) | hash_taxid | Fraud detection |
  ```

- DG-57: **The `data-lineage.md` must be updated as part of the PR** that introduces any change to data inputs, storage, or outputs. Reviewers must reject PRs that touch data flows without updating the lineage document.

### 6.2 Event Metadata Requirements

- DG-58: **Every domain event and integration event that carries or relates to personal data must include** a metadata envelope with at minimum:

  ```json
  {
    "metadata": {
      "eventId": "<uuid>",
      "eventType": "OrderPlaced",
      "occurredAt": "2025-11-15T10:30:00Z",
      "producerService": "order-service",
      "dataClassification": "PII",
      "processingPurpose": "ContractExecution",
      "legalBasis": "LGPD_Art7_V",
      "subjectIdToken": "<token — never raw subjectId if PII>",
      "correlationId": "<uuid>",
      "schemaVersion": "1.2.0"
    },
    "payload": { }
  }
  ```

- DG-59: **`dataClassification` must reflect the highest classification of any field in the payload.** If the payload contains one PII field, the envelope classification is `PII`.

- DG-60: **`processingPurpose` must be a value from the organization's controlled vocabulary**, maintained in the governance repository. Free-text purposes are not acceptable. Defined values include: `ContractExecution`, `LegalObligation`, `ConsentBased`, `LegitimateInterest`, `FraudPrevention`, `RightToErasure`, `DataSubjectRequest`, `Analytics_Anonymized`.

### 6.3 Audit Logging for PII Access

- DG-61: **Every access to a PII field must generate an audit log entry.** "Access" means any read, write, update, or delete operation on a PII-classified field, whether via API, direct DB query, batch job, or admin tool.

- DG-62: **Audit log entries for PII access must contain:**

  ```json
  {
    "auditEventType": "PII_ACCESS",
    "timestamp": "2025-11-15T10:30:00.123Z",
    "who": {
      "principalId": "usr_abc123",
      "principalType": "ServiceAccount | HumanUser | AdminUser",
      "serviceId": "order-service",
      "ipAddress": "192.168.***.***"
    },
    "what": {
      "resourceType": "Customer",
      "resourceId": "<token — not raw PII>",
      "fieldsAccessed": ["email", "fullName"],
      "operation": "READ | WRITE | DELETE"
    },
    "when": "2025-11-15T10:30:00.123Z",
    "purpose": "OrderFulfillment",
    "legalBasis": "LGPD_Art7_V",
    "correlationId": "<uuid>"
  }
  ```

- DG-63: **Audit logs for PII access must be stored in an append-only, tamper-evident store** separate from the application logs. Retention: 5 years (DG-31). Write access to the audit log store must be restricted to the logging pipeline only; no service may delete or modify audit entries.

- DG-64: **Audit logs must themselves not contain raw PII.** `resourceId` must use the internal token, not the raw identifier. `fieldsAccessed` lists field names, not values. IP addresses follow the masking rule in DG-21.

- DG-65: **Anomalous access patterns must trigger automated alerts.** Minimum thresholds: a single principal accessing PII of more than 500 distinct subjects within 1 hour must trigger a P1 alert to the security team and DPO.

---

## 7. Data Quality

### 7.1 Validation at the Boundary

- DG-66: **Data must be validated at the system boundary before it enters any internal processing.** This applies to all ingress points: REST API endpoints, message consumers, file ingestion jobs, webhook receivers, and admin import tools. Unvalidated data must not reach domain logic or persistence.

  Minimum validation requirements at boundary:
  - Schema validation: required fields present, correct types
  - Format validation: CPF check digit, email regex, phone E.164 format, UUID v4 pattern
  - Range validation: dates within plausible bounds, numeric values within domain constraints
  - PII completeness: if a PII field is provided, its associated mandatory context must also be provided (e.g., consent record ID if legal basis is consent)

- DG-67: **Validation failures must be returned to the caller with machine-readable error codes.** Error responses must identify the failing field and the constraint violated. They must not echo back PII values in error messages.

  Required error response structure for validation failures:

  ```json
  {
    "type": "VALIDATION_ERROR",
    "errors": [
      {
        "field": "taxId",
        "code": "INVALID_CPF_CHECKSUM",
        "message": "CPF failed check digit validation."
      }
    ]
  }
  ```

- DG-68: **C# boundary validation example**:

```csharp
// DG-66 — validation at the API boundary, before domain logic
public record CreateCustomerRequest(
    [Required, RegularExpression(@"^\d{3}\.\d{3}\.\d{3}-\d{2}$")]
    string TaxId,          // DG-04: PII

    [Required, EmailAddress, MaxLength(254)]
    string Email,          // DG-04: PII

    [Required, MaxLength(200)]
    string FullName,       // DG-04: PII

    [Required]
    string ConsentRecordId // DG-43: consent basis requires reference
);

// DG-67 — validation error must NOT echo PII values back
[HttpPost]
public async Task<IActionResult> CreateCustomer(
    [FromBody] CreateCustomerRequest request)
{
    if (!ModelState.IsValid)
        return UnprocessableEntity(ModelState); // framework strips values; verify this in tests
    // ... proceed to domain
}
```

### 7.2 Nullability Policy

- DG-69: **Every nullable field must carry an explicit nullability declaration and a documented fallback policy.** "Nullable because we don't know" is not an acceptable policy. The declaration must answer: when is this null, and what does null mean for business logic?

  Acceptable nullability policies:
  - `NULL_MEANS_UNKNOWN`: value was not collected; system must handle absence gracefully
  - `NULL_MEANS_NOT_APPLICABLE`: concept does not apply to this record type
  - `NULL_MEANS_PENDING`: value will be populated by a subsequent process; record is incomplete

- DG-70: **Nullable PII fields must never be defaulted to a non-null sentinel value** (e.g., `"N/A"`, `"unknown"`, `"0"`) as a substitute for null. Sentinel values corrupt data quality analytics and can create false matches in deduplication.

### 7.3 Invalid Data Handling

- DG-71: **Inconsistent or invalid data must be rejected or quarantined — never silently accepted.** Silent coercions (e.g., truncating a string that is too long, rounding a value outside range) are forbidden without explicit configuration and logging.

- DG-72: **The quarantine pattern must be used for batch/stream ingestion** when the source cannot be blocked synchronously. Invalid records are written to a quarantine store with: original payload, validation error details, timestamp, source identifier, and a correlation ID for recovery.

  Quarantine record requirements:
  - Must not store raw PII in the quarantine store longer than 7 days
  - Must trigger an alert to the owning team within 1 hour of first quarantine for a batch
  - Must have a defined recovery or discard SLA (maximum 7 business days)

### 7.4 Schema Evolution and Data Quality

- DG-73: **Adding a nullable field to an existing schema is a safe operation and does not require an ADR.** However, the new field must be documented in `data-lineage.md`, classified per DG-04, and have a nullability policy per DG-69.

- DG-74: **The following schema changes are breaking and require an ADR before implementation:**
  - Removing any field (nullable or required)
  - Renaming any field
  - Changing the type of any field (including widening, e.g., `int` to `long`)
  - Changing the nullability of a field from nullable to required
  - Changing the classification of a field downward (e.g., PII to Internal) — also requires DPO approval

- DG-75: **Data quality metrics must be instrumented for all PII-processing pipelines.** Minimum required metrics:
  - `data_quality.validation_failures_total` — counter, labelled by `service`, `field`, `error_code`
  - `data_quality.quarantined_records_total` — counter, labelled by `service`, `source`
  - `data_quality.schema_evolution_events_total` — counter, labelled by `service`, `change_type`

  These metrics must be available in the observability platform (see Observability Playbook) and must have alert rules for abnormal rejection rates (threshold: >1% rejection rate on a field triggers a P2 alert).

---

## Appendix A: Data Classification Annotation Reference

| Stack | Mechanism | Example |
|---|---|---|
| C# / .NET | `[DataClassification(Level.PII)]` attribute on property | See DG-06 |
| Java / Spring | `@DataClassification(Level.PII)` annotation on field | See DG-07 |
| Go | `data-classification:"PII"` struct tag | See DG-08 |
| PostgreSQL | `COMMENT ON COLUMN ... IS 'classification:PII'` | See DG-09 |
| JSON Schema / Avro | `"x-classification": "PII"` field-level extension | See DG-10 |
| Kafka event envelope | `metadata.dataClassification` field (required) | See DG-58 |

---

## Appendix B: Mandatory Artifacts Checklist per Service

| Artifact | Required When | Location |
|---|---|---|
| `data-inventory.md` | Service processes any PII field | Repository root or `/docs/` |
| `data-lineage.md` | Service processes any data (any classification) | Repository root |
| `ropa-entry.md` | Service processes PII | Repository root or `/docs/` |
| `dpia/DPIA-YYYY-NNN.md` | DPIA triggers met (DG-48) | `.specs/decisions/dpia/` |
| DPO sign-off record | Service processes PII, before production | Referenced in `data-inventory.md` |
| LIA (Legitimate Interest Assessment) | Legal basis is legitimate interest (DG-43) | Referenced in `ropa-entry.md` |

---

## Appendix C: Controlled Vocabulary — Processing Purposes

| Token | Description |
|---|---|
| `ContractExecution` | Processing necessary to perform a contract with the subject |
| `LegalObligation` | Processing required by applicable law or regulation |
| `ConsentBased` | Processing based on freely given, specific, informed consent |
| `LegitimateInterest` | Processing based on LIA-approved legitimate interest |
| `FraudPrevention` | Anti-fraud, identity verification, risk scoring |
| `RightToErasure` | Processing triggered by a data subject erasure request |
| `DataSubjectRequest` | Processing triggered by any data subject rights request |
| `Analytics_Anonymized` | Analytics processing on fully anonymized (non-PII) data |
| `SecurityIncidentResponse` | Processing in the context of a security breach investigation |
| `AuditAndCompliance` | Processing for internal compliance audit purposes |

---

## Appendix D: Rule Quick Reference

| Rule | Summary |
|---|---|
| DG-01 | Every field must have explicit data classification |
| DG-02 | Four levels: PUBLIC, INTERNAL, CONFIDENTIAL, PII |
| DG-03 | Classify at field level, not table level |
| DG-04 | Classification must be machine-readable (annotation/tag) |
| DG-05 | Downgrading classification requires ADR + DPO approval |
| DG-06–10 | Stack-specific classification annotation rules |
| DG-11 | PII definition per LGPD Art. 5 |
| DG-12 | Sensitive data requires stricter basis (LGPD Art. 11) |
| DG-13 | Exhaustive PII field type list |
| DG-14 | Pseudonymized data is still PII |
| DG-15 | Every PII service must have `data-inventory.md` |
| DG-16 | DPO must sign off before PII service goes to production |
| DG-17 | PII never in logs, traces, or metrics |
| DG-18 | PII never in error messages |
| DG-19 | PII never in URL paths or query strings |
| DG-20 | Each PII field has one declared primary storage location |
| DG-21 | Masking formats mandated by field type |
| DG-22–24 | Masking implementation per stack (C#, Java, Go) |
| DG-25 | Tokenization required for analytics/BI systems |
| DG-26 | SHA-256 + salt for irreversible hashing |
| DG-27 | MD5 and SHA-1 forbidden for PII |
| DG-28 | AES-256 encryption at rest for Confidential and PII |
| DG-29 | Encryption keys must be separate from encrypted data |
| DG-30 | TLS 1.3 required; TLS 1.2 minimum; mTLS for PII service calls |
| DG-31 | Mandatory retention periods by data category |
| DG-32 | Retention must be enforced automatically |
| DG-33 | Retention applies to all copies |
| DG-34 | PII must support hard delete |
| DG-35 | Anonymization in place must be irreversible |
| DG-36 | Soft delete acceptable for non-PII |
| DG-37 | Right to Erasure fulfilled within 15 business days |
| DG-38 | Erasure covers all systems |
| DG-39 | Erasure exceptions require legal basis documented to subject |
| DG-40 | `UserDataDeletionRequested` event drives cascading deletion |
| DG-41 | Backup retention cannot exceed primary retention |
| DG-42 | Restoring deleted PII via backup requires DPO approval |
| DG-43 | Every processing activity must declare legal basis |
| DG-44 | Sensitive data requires LGPD Art. 11 basis |
| DG-45 | Consent records stored immutably |
| DG-46 | Every PII service contributes a `ropa-entry.md` |
| DG-47 | ROPA entries reviewed annually |
| DG-48 | DPIA mandatory before high-risk processing launch |
| DG-49 | DPIA stored in `.specs/decisions/dpia/` |
| DG-50 | Data subject rights deadlines (15 business days) |
| DG-51 | All subject requests routed through DPO channel |
| DG-52 | Rights request fulfillment logged immutably |
| DG-53 | ANPD breach notification within 72 hours |
| DG-54 | Affected subjects notified without undue delay |
| DG-55 | Breach detection is P0; DPO escalation within 1 hour |
| DG-56 | Every service must have `data-lineage.md` |
| DG-57 | `data-lineage.md` updated in PRs that change data flows |
| DG-58 | Domain events require `dataClassification` + `processingPurpose` metadata |
| DG-59 | Event envelope classification = highest field classification |
| DG-60 | `processingPurpose` from controlled vocabulary only |
| DG-61 | Every PII field access generates an audit log entry |
| DG-62 | Audit log entry required fields (who, what, when, purpose) |
| DG-63 | Audit logs in append-only, tamper-evident, separate store; 5y retention |
| DG-64 | Audit logs must not contain raw PII |
| DG-65 | Automated alert for anomalous PII access (>500 subjects/1h) |
| DG-66 | Validation at system boundary before domain logic |
| DG-67 | Validation errors are machine-readable; must not echo PII |
| DG-68 | C# boundary validation example |
| DG-69 | Every nullable field requires explicit nullability policy |
| DG-70 | Nullable PII must not use sentinel values |
| DG-71 | Invalid data is rejected or quarantined; never silently accepted |
| DG-72 | Quarantine pattern required for batch/stream ingestion |
| DG-73 | Adding nullable field is safe; no ADR required |
| DG-74 | Removing/renaming/retyping fields requires ADR |
| DG-75 | Data quality metrics mandatory for PII pipelines |
