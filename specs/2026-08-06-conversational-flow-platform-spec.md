# Spec: Plataforma conversacional y motor genérico de flujos

**Estado:** Borrador normativo para aprobación condicional
**Fecha:** 2026-08-06
**Repositorio:** `universe`
**Alcance:** Infraestructura genérica para definir, validar, simular, publicar, ejecutar, pausar y retirar flujos conversacionales dentro de los patrones soportados por v1.
**Fuera de alcance:** El contenido y las reglas concretas de Ventas, Cobros u otras áreas.

Las palabras **DEBE**, **NO DEBE**, **PUEDE** y **DEFERRED** son normativas. Una garantía solo se considera implementada cuando existen el mecanismo persistente y la prueba automatizada indicados por este documento.

---

## 1. Resumen ejecutivo

Se construirá dentro de `universe` una plataforma conversacional propia. Meta WhatsApp Cloud será el primer adapter de canal y Chatwoot el primer adapter de atención humana. La lógica, la autoridad de ejecución y los datos canónicos permanecerán bajo control de Cashin.

La plataforma ejecutará definiciones declarativas, compiladas y versionadas. Un usuario autorizado podrá componer **los patrones explícitamente soportados por v1** sin modificar el runtime ni desplegar código. Una capacidad, patrón o integración no registrada requiere código TypeScript, contrato, pruebas, revisión y despliegue.

> **Las capacidades se implementan en código; los flujos componen capacidades registradas como datos.**

No se promete expresar “cualquier flujo”. v1 soporta secuencias, ramas deterministas, captura de input, una espera correlacionada con timeout, acciones registradas, entrega humana y terminación. Fork/join, compensaciones generales, scopes de excepción, múltiples carreras, recursión y subflows quedan fuera de v1. La arquitectura define seams extensibles para incorporarlos sin esconder lógica en scripts o actions.

Las tres garantías críticas son:

1. un efecto lógico conserva el mismo `logicalEffectId` en todos sus intentos y se registra en un ledger con hash de payload y reconciliación;
2. la autorización runtime usa `trustedClaims` system-owned con procedencia verificable, nunca variables editables por el flujo;
3. una versión publicada fija un manifest compilado de handlers, actions, adapters de canal/handoff, pipeline de medios, claims, codec/ejecutor, contenido, plantillas, expresiones, políticas y una resolución ambiental inmutable, de modo que un run no resuelva dependencias “latest” ni cambie silenciosamente de destino físico.

---

## 2. Alcance, objetivos y patrones

### 2.1 Objetivos funcionales

1. Crear cualquier cantidad de definiciones que solo compongan patrones y capacidades registradas.
2. Editar borradores sin afectar versiones publicadas ni runs activos.
3. Agregar, duplicar, mover, configurar o borrar steps con análisis de grafo, dataflow y dominancia.
4. Validar, simular y publicar snapshots inmutables y reproducibles.
5. Fijar cada run a una versión y a su manifest compilado; **no migrar runs activos en v1**.
6. Vincular triggers, canales y ambientes mediante bindings explícitos.
7. Procesar texto, selecciones y, solo tras pasar los controles de seguridad, medios permitidos.
8. Ejecutar tareas diferidas, expiraciones y una carrera correlacionada evento-vs-timeout.
9. Transferir autoridad de respuesta a una bandeja humana mediante una saga idempotente.
10. Mantener auditoría, métricas, reconciliación y controles operativos.

### 2.2 Objetivos técnicos

1. Monolito modular TypeScript/Bun dentro de CRM en v1.
2. Postgres como fuente de verdad para estado, inbox, jobs, runs, ledger y auditoría, sujeto a los límites de capacidad de §14.
3. JSONB como snapshot de definición y manifest, sujeto a canonicalización, migradores e inmutabilidad física de §6.4.
4. R2 para blobs privados ya saneados; la cuarentena no es contenido disponible.
5. Entrega inbound al menos una vez con materialización lógica única. Los efectos externos tendrán la garantía declarada por adapter; Postgres no los vuelve exactamente-once.
6. Motor puro que no conoce red, credenciales, Postgres, Meta, Chatwoot ni sistemas de negocio y solo produce comandos.
7. Simulador fail-closed con dependencias in-memory, reloj e IDs inyectados y red denegada.
8. Worker extraíble si se superan umbrales verificables, sin cambiar el dominio ni el protocolo persistente.

### 2.3 Patrones soportados y no soportados en v1

| Patrón | v1 | Semántica |
|---|---:|---|
| Secuencia lineal | Sí | Un step activo y una transición por resultado. |
| Rama condicional | Sí | AST seguro, evaluación determinista y primera rama válida única. |
| Captura de texto/opción/media | Sí, media condicionada | Pausa hasta evento correlacionado o expiración. |
| Espera por evento o timeout | Sí | Un `wait` registra exactamente un evento esperado y un timer; el primero reclamado bajo lock gana y cancela lógicamente al perdedor. |
| Acción registrada | Sí | Comando al Action Registry con policy runtime y effect ledger. |
| Handoff humano largo | Sí | Saga y autoridad única de respuesta. |
| Ciclo | Limitado | Solo retorno explícito a un step de espera/input con presupuesto de activaciones y tiempo. |
| Fork/join o paralelismo dentro de un run | No | **DEFERRED**. |
| Espera por múltiples eventos o carreras N-way | No | **DEFERRED**; requiere nueva primitiva. |
| Compensación genérica/saga declarativa de negocio | No | **DEFERRED**; una compensación concreta debe ser una action privilegiada y explícita. |
| Scopes de excepción/cancelación propagada | No | **DEFERRED**. |
| Aprobación humana dual dentro de un flujo | No | **DEFERRED**; no confundir con aprobación dual de publicación. |
| Subflows/recursión | No | `invoke_subflow` no existe en el catálogo v1. **DEFERRED** hasta definir versión, contrato, presupuesto, permisos y cancelación globales. |
| JavaScript, SQL, shell, `eval` o HTTP genérico | Nunca | Prohibido. |

### 2.4 No objetivos

No se definen preguntas, copy, decisiones financieras, campañas, OCR, IA generativa, otros canales, canvas tipo n8n ni mecanismos concretos de autenticación de un bot. Antes de habilitar una action sensible sí DEBE existir al menos un emisor de claims aprobado para el nivel requerido.

---

## 3. Principios e invariantes

### 3.1 Principios

- **Capacidades en código, composición como datos.** Toda action tiene esquema, autorización, versionado, pruebas y adapter.
- **Versiones publicadas inmutables y ejecutables.** No se resuelve ninguna dependencia mutable al reanudar.
- **Engine puro, efectos afuera.** El engine recibe estado y evento canónicos y devuelve nuevo estado y commands.
- **Autorización en dos tiempos.** El compilador rechaza capacidades no concedidas y el runtime vuelve a autorizar justo antes de despachar cada efecto.
- **Configuración como software.** Esquema, diff semántico, CAS, aprobación por hash, promoción y rollback.
- **Adapters en seams canónicos.** La validación HTTP queda fuera del `ChannelAdapter`; Chatwoot y Meta no filtran tipos al dominio.
- **Fail closed.** Dependencia, versión, claim, policy, fixture o reconciliador ausente bloquea ejecución/publicación; nunca cae a un default productivo.

### 3.2 Invariantes normativos

1. Un run referencia exactamente un `flowVersionId` publicado, su `compiledManifestId/hash` y su `environmentResolutionSnapshotId/hash` inmutable.
2. Definición, manifest y filas publicadas no se actualizan ni borran; `SUPERSEDED` es metadata separada y no muta el snapshot.
3. Cada activación de step tiene un `activationOrdinal` monotónico dentro del run.
4. Cada efecto lógico tiene un `logicalEffectId` estable; cada envío/reintento tiene un `executionAttemptId` distinto.
5. Una restricción única impide dos ledger rows para el mismo `logicalEffectId`; reusar el ID con otro `payloadHash` es corrupción y detiene el run.
6. `trustedClaims` solo pueden ser emitidos/revocados por componentes system-owned registrados; ningún step ni action ordinaria puede escribirlos.
7. Cada action se autoriza en runtime con manifest, grant del ambiente, trusted claims vigentes, propósito, clasificación y kill switches.
8. Un evento inbound aceptado tiene, en la misma transacción, una fila inbox y exactamente un job lógico materializado.
9. Cada conversación recibe `conversationSequence` monotónico y se procesa bajo lock/CAS de conversación en orden interno.
10. Como máximo existe un run automatizado no terminal por conversación en v1; un handoff activo cuenta como ese run.
11. Un command nunca ejecuta I/O dentro del engine.
12. El simulador no puede construir adapters de producción, leer secret refs ni abrir red.
13. Borrar/reconectar un step no puede quitar un dominador de inicialización, seguridad o efecto requerido sin error bloqueante y elección explícita.
14. Toda versión con una action sensible alcanzable requiere `automation.publish_sensitive` y una segunda aprobación por actor distinto ligada al hash exacto.
15. Los runs activos no se migran entre versiones en v1. Rollback solo cambia nuevas entradas; los runs antiguos se drenan o cancelan.
16. Solo una autoridad (`BOT`, `HUMAN_INBOX` o `NONE`) puede emitir respuestas de conversación.
17. Un medio no sale de cuarentena antes de pasar allowlist de origen, streaming con límites, magic bytes y antimalware.
18. Ninguna garantía end-to-end de “exactly once” se presume por usar Postgres u outbox.
19. Todo command del que dependa una transición deja al run en `WAITING_EFFECT` con una continuation durable; ningún resultado se consume ni materializa más de una vez lógicamente. v1 permite como máximo un command bloqueante por activación.
20. `UNKNOWN`, `RECONCILING` y `MANUAL_REVIEW` bloquean el run y nunca producen por sí solos un outcome del flow.
21. Un dispatcher no acepta claims autoritativos desde definitions, variables, snapshots, commands ni DTO del flow; los carga exclusivamente del `TrustedClaimRepository` system-owned.

---

## 4. Modelo de dominio y separación de confianza

### 4.1 Entidades principales

| Entidad | Propósito |
|---|---|
| Flow | Identidad estable y lifecycle administrativo. |
| Draft | Documento mutable con `draftRevision` y hash CAS. |
| Flow Version | Snapshot publicado, inmutable y asociado a manifest. |
| Compiled Manifest | Resolución exacta de todas las dependencias ejecutables. |
| Binding | Ruta versionada de trigger/canal/cuenta a Flow. |
| Conversation | Secuenciador y autoridad de respuesta por participante/canal. |
| Flow Run | Ejecución fijada a versión y manifest. |
| Step Activation / Step Run | Activación lógica e intentos de computación del step. |
| Inbound Event | Inbox deduplicado y ordenado internamente. |
| Job | Unidad durable de trabajo con lease. |
| Command | Descripción pura de un efecto solicitado por el engine. |
| Effect Ledger | Estado, hash, intentos y reconciliación del efecto lógico. |
| Effect Continuation | Correlación durable entre efecto esperado, mapping de resultado y reanudación única. |
| Handoff | Saga de transferencia de autoridad humana. |
| Trusted Claim | Afirmación system-owned con procedencia y vigencia. |
| Environment Resolution Snapshot | Destinos físicos no secretos y generaciones de trust/config fijados al publicar. |
| Replay Request | Solicitud administrativa única para reprocesar un inbox terminal sin reutilizar el job original. |

### 4.2 Contexto

El input del engine se divide y tipa así:

```ts
interface EngineContext {
  userVariables: Readonly<Record<string, TypedValue>>;
  trustedClaims: Readonly<TrustedClaim[]>;
  systemFacts: Readonly<SystemFacts>;
}

interface TrustedClaim {
  claimType: string;
  subjectId: string;
  assuranceLevel: "ANONYMOUS" | "PHONE_MATCHED" | "VERIFIED" | "STRONG_VERIFIED";
  issuerKey: string;
  issuerVersion: string;
  method: string;
  evidenceRef: string; // opaca, no evidencia cruda
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
}
```

- `userVariables` son las únicas variables escribibles por `set_variable` y resultados declarativos.
- `trustedClaims` y `systemFacts` son read-only para definición, editor, expresión y handlers. La vista del engine es informativa para evaluación pura; no es una fuente autoritativa para dispatch.
- Solo un `TrustedClaimIssuer` registrado, autorizado por policy y auditado puede emitir/revocar claims.
- El compilador rechaza cualquier `saveAs`, mapping o expresión que tenga como destino el namespace reservado.
- El runtime valida issuer, firma/evidencia, subject, expiración, revocación, canal y método antes de cada action sensible.
- Un resultado de una action ordinaria no se convierte implícitamente en claim.
- Commands, continuations, action results, user variables y DTO del flow **NO DEBEN** contener un array de claims con autoridad de ejecución. Solo pueden transportar `subjectId` y `conversationId` opacos para que infraestructura recupere claims.

### 4.3 Authorization Decision

Antes de crear un intento externo, el dispatcher solicita al Policy Engine:

```ts
interface AuthorizationDecisionInput {
  logicalEffectId: string;
  manifestHash: string;
  actionRef: ResolvedActionRef;
  flowGrantId: string;
  environment: string;
  purpose: string;
  trustedClaims: readonly TrustedClaim[];
  dataClasses: readonly string[];
}
```

El dispatcher construye este input: recibe únicamente `subjectId/conversationId` desde el command/run, carga `trustedClaims` directamente mediante un `TrustedClaimRepository` system-owned, valida allí issuer/firma o evidencia, subject, vigencia, revocación, canal y método, y recién entonces entrega la colección validada al Policy Engine. El repositorio usa una conexión/rol sin escritura por flows, handlers ni actions ordinarias. El Policy Engine **NO DEBE** aceptar como autoritativo un array suministrado por un command, definition, engine snapshot o DTO del flow; la API de producción hace esa ruta imposible por tipos y composition root, y un intento se rechaza y audita.

El resultado contiene `ALLOW` o `DENY`, policy version, razones y hash canónico del input. `DENY` no se reintenta automáticamente. La decisión y la generación del repositorio consultada se guardan en el ledger. La validación de publicación nunca sustituye esta evaluación runtime.

---

## 5. Arquitectura: monolito modular y seams

### 5.1 Forma v1

La implementación vivirá en el backend/frontend existentes de CRM para reutilizar autenticación, roles, Postgres, R2, despliegue y observabilidad. La separación es modular, no un microservicio prematuro. La ubicación exacta DEBE revalidarse contra `origin/develop` antes de implementar.

Módulos profundos mínimos:

- **Definition Compiler:** parsea schema version, valida grafo/dataflow/policy y produce manifest.
- **Pure Flow Engine:** transición determinista y producción de commands.
- **Runtime Coordinator:** transacciones, locks, jobs, ledger y state machines.
- **Action Registry:** descriptores y adapters versionados.
- **Policy Engine:** grants, sensibilidad, claims y kill switches.
- **Effect Sink:** persiste commands en ledger; nunca despacha durante la transacción del engine.
- **Channel Adapter:** eventos/mensajes canónicos, sin `Request` HTTP.
- **Human Inbox Adapter:** saga canónica de handoff.
- **Media Pipeline:** streaming, cuarentena, validación y promoción.

Action Registry, Policy Engine y Effect Sink son dependencias de **Fase 1**, incluso si todavía solo tienen adapters fake.

### 5.2 Engine puro

```ts
interface FlowEngine {
  start(input: PureStartInput): EngineTransition;
  resume(input: PureResumeInput): EngineTransition;
}

interface EngineTransition {
  nextRunState: RunStateSnapshot;
  commands: readonly Command[];
  auditFacts: readonly AuditFact[];
}
```

El engine:

- no hace I/O ni retorna `Promise`;
- no conoce retries de infraestructura; solo emite una `RetryPolicyRef` compilada por command;
- recibe `Clock`, `IdProvider` determinista y límites como valores;
- asigna identidad lógica reproducible a commands con `runId`, `stepId`, `activationOrdinal`, `commandKind` y `commandOrdinal`;
- no ejecuta actions, envía mensajes ni crea handoffs directamente.

El scheduler aplica leases/backoff; el engine decide transiciones de negocio. Esta división elimina la contradicción entre “motor puro” y retries persistentes.

### 5.3 Interfaces canónicas

```ts
interface ChannelAdapter {
  normalize(payload: VerifiedProviderPayload): readonly InboundEvent[];
  dispatch(input: DispatchMessageInput): Promise<DispatchObservation>;
  reconcile(input: ReconcileMessageInput): Promise<ReconcileObservation>;
}

interface ActionAdapter {
  execute(input: ExecuteActionAttempt): Promise<ActionObservation>;
  reconcile?(input: ReconcileActionInput): Promise<ReconcileObservation>;
}

interface HumanInboxAdapter {
  request(input: HandoffAttempt): Promise<HandoffObservation>;
  reconcile(input: ReconcileHandoffInput): Promise<HandoffObservation>;
  close(input: CloseHandoffAttempt): Promise<HandoffObservation>;
}
```

El endpoint HTTP verifica firma, tamaño y autenticidad y entrega un `VerifiedProviderPayload`; `Request` no cruza el seam del canal.

Cada método `reconcile` tiene en su descriptor inmutable `reconcileMode: "READ_ONLY" | "WEBHOOK_ONLY" | "MUTATING"`. `READ_ONLY` solo consulta; `WEBHOOK_ONLY` únicamente consume observaciones autenticadas ya recibidas y no inicia I/O mutating; `MUTATING` puede causar el efecto. En un estado ambiguo solo se ejecutan automáticamente los dos primeros. Un reconciliador `MUTATING` **NO DEBE** ejecutarse automáticamente: pasa a `MANUAL_REVIEW` y exige la autorización de resolución de §11.3. Contract tests interceptan métodos/red y prueban cero requests mutating durante reconciliación automática.

### 5.4 Simulador fail-closed

El simulador invoca el mismo engine puro, pero un composition root independiente solo acepta:

- repositorios in-memory;
- `FakeActionRegistry` con fixture exhaustivo por action/version;
- `RecordingEffectSink`;
- fake channel/handoff adapters;
- reloj, RNG e IDs deterministas;
- policy fixture explícita;
- transporte con network deny a nivel de proceso/runner.

Cada dependencia expone `capabilityMode: "SIMULATION" | "PRODUCTION"`. El arranque falla si no es `SIMULATION`, si existe un `secretRef`, si falta un fixture o si se intenta abrir socket/DNS. No existe fallback al registry productivo. Una prueba de aceptación intercepta socket/DNS y exige cero intentos.

---

## 6. Definición, compilación y reproducibilidad

### 6.1 Draft y JSON canónico

La definición se almacena como JSONB, pero su hash se calcula sobre UTF-8 de **JSON Canonicalization Scheme RFC 8785** después de normalizar al schema version objetivo. Esta regla aplica sin excepción a `definitionHash`, `compiledManifestHash`, `environmentResolutionSnapshotHash`, hash de promoción/aprobación, policy-input hash, payload hash y request hash: cada preimagen es un envelope JSON tipado y versionado canonicalizado con RFC 8785. Fechas se normalizan a RFC 3339 UTC con milisegundos y sufijo `Z`; bytes se representan como base64url sin padding junto con media type/length; strings son Unicode sin normalización implícita; arrays conservan el orden definido por el schema y, si representan sets, se ordenan por su clave canónica antes de hashear; maps se canonicalizan. Números no representables de forma estable, fechas no canónicas y claves duplicadas se rechazan. Blobs se hashean sobre bytes crudos con algoritmo/version declarados y su digest se incorpora al envelope RFC 8785. No se permite hashear la serialización accidental de DB, lenguaje o transporte.

Cada operación de edición requiere:

```text
expectedDraftRevision + expectedDefinitionHash
```

La escritura hace CAS y crea `draftRevision + 1`; un mismatch retorna conflicto con diff, nunca last-write-wins. v1 mantiene **un draft compartido por Flow**, no branches por editor.

### 6.2 Compiled Manifest

Publicar compila, no solo copia JSON. El manifest inmutable fija, por cada nodo alcanzable:

- `stepHandlerKey`, `stepHandlerVersion` e `implementationCompatibilityId`;
- `actionKey`, `actionContractVersion` e `implementationCompatibilityId` exactos;
- `contentVersionId` y `contentHash` exactos;
- `templateProviderId`, `templateVersionId`, locale y hash exactos;
- `expressionLanguageVersion` y hash del AST normalizado;
- `policyBundleVersion`, grants resueltos y retry/timeout/retention policy versions;
- schemas de input/output y hashes;
- clasificación y lineage de datos;
- bindings relevantes para promoción como dependency refs, sin fijar secretos;
- `channelAdapterKey`, contract version e `implementationCompatibilityId` para cada command de canal alcanzable;
- `humanInboxAdapterKey`, contract version e `implementationCompatibilityId` para request/reconcile/close alcanzables;
- `mediaPipelineContractVersion`, scanner engine/signature compatibility ID y límites versionados cuando media sea alcanzable;
- `trustedClaimIssuerKey/version`, verifier contract/compatibility ID y `trustRootGeneration` requeridos por cada claim;
- `canonicalCodecVersion` y `expressionExecutorCompatibilityId` usados para decode, migración, hashing y evaluación;
- `environmentResolutionSnapshotId` y `environmentResolutionSnapshotHash` de §6.3;
- `subflows: []` en v1.

Un run nunca resuelve `latest`. El runtime mantiene implementaciones compatibles mientras exista un run no terminal o dato retenido que las referencie. Un despliegue DEBE rechazar retirar una compatibilidad alcanzable. Si una dependencia queda excepcionalmente no ejecutable, el run pasa a `BLOCKED_DEPENDENCY`, no a otra versión; operación decide restaurar implementación, drenar o cancelar.

### 6.3 Dependency Manifest por ambiente

El artefacto de promoción contiene:

- `definitionHash` y `compiledManifestHash`;
- versiones lógicas de handlers/actions/policies/contenido/plantillas;
- capacidades del adapter y garantía de efectos;
- issuer de claims requerido;
- destino lógico de handoff;
- versiones/compatibility IDs exactos de Channel Adapter, Human Inbox Adapter, media scanner/pipeline, claim issuer/verifier/trust-root generation y codec/ejecutor;
- `environmentResolutionSnapshotId/hash` inmutables;
- límites y retención;
- secret refs **por nombre**, nunca valores.

Antes de publicar en cada ambiente se genera una resolución y se compara. Una dependencia ausente, incompatible o con clasificación/grant distinto bloquea. El snapshot de resolución ambiental es una fila append-only ligada a manifest y contiene, sin secretos, los destinos físicos resueltos: provider/account ID, inbox/team ID, endpoint origin/region, template namespace, logical binding y generaciones de configuración/trust. Su hash cubre esos valores mediante §6.1. Los valores de secretos quedan fuera y solo se atestan `secretRef`, tipo y generación; rotar el valor bajo la misma identidad no cambia el snapshot. Cambiar destino, identidad física, endpoint, región, trust root o tipo de secret crea obligatoriamente una nueva generación/snapshot y no afecta runs existentes. El run fija ambos hashes y ambos IDs al comenzar; resume, dispatch, reconcile y close leen exclusivamente esas referencias, nunca aliases mutables.

El hash de promoción cubre `definitionHash + compiledManifestHash + environmentResolutionSnapshotHash` mediante el envelope canónico de §6.1. La retención/deploy guard incluye todos los adapters, scanner, verifier, trust roots, codecs, ejecutores y snapshots alcanzables: no se pueden retirar mientras un run no terminal o dato reconciliable los referencie.

### 6.4 Evolución de schema e inmutabilidad física

- Existe un codec y migrador puro por cada `schemaVersion` soportada.
- Las migraciones son encadenadas, deterministas e idempotentes y tienen golden tests de canonical hash.
- Se conservan lectores/ejecutores para versiones con runs o retención vigente; no se migra el snapshot publicado in-place.
- Publicar crea una nueva fila; rollback crea otra versión publicada basada en una anterior.
- Permisos de DB niegan `UPDATE/DELETE` sobre snapshots/manifests publicados; un trigger/constraint defensivo rechaza cambios de definición/hash. Solo metadata lifecycle separada puede cambiar.
- Un verificador periódico recalcula hashes y alerta ante divergencia.

### 6.5 Análisis del compilador y borrado de steps

Además de referencias, tipos, ciclos y terminación, el compilador calcula por path:

- variables definitivamente inicializadas;
- outputs disponibles y su procedencia;
- dominadores de cada step;
- dominadores de seguridad/claim requeridos;
- precondiciones de actions y efectos previos requeridos;
- cambio de clasificación/lineage hacia contenido, action, handoff y binding;
- alcanzabilidad de toda action sensible.

Borrar/reconectar un step produce un blast-radius semántico. La reconexión automática solo se permite si hay una salida inequívoca **y** no cambia dominancia, inicialización, seguridad, efecto requerido ni clasificación. Si cambia cualquiera, la operación falla hasta que el editor repare explícitamente el grafo y vuelva a validar. Variables declaradas pero no definitivamente inicializadas no satisfacen un read no-null.

### 6.6 Publicación y aprobación por hash

Publicación transaccional:

1. CAS sobre `draftRevision` y `definitionHash` revisados;
2. compilar y producir manifest/hash;
3. ejecutar tests/scenarios guardados;
4. evaluar policy sobre **todo el grafo alcanzable**;
5. registrar aprobación(es) para ese `definitionHash + compiledManifestHash + environmentResolutionSnapshotHash + environment`;
6. invalidar automáticamente aprobaciones si cambia cualquiera de esos valores;
7. crear snapshots inmutables y cambiar versión activa;
8. registrar actor, aprobadores distintos, comentario, diff y evento outbox.

Toda versión que pueda alcanzar una action mutating, financiera, privileged o datos clasificados como sensibles requiere `automation.publish_sensitive` y una segunda aprobación de actor distinto del editor/publicador. No importa si la action ya existía. Cambiar input, dominador, claim, binding, exposición o retención también se detecta semánticamente.

---

## 7. Catálogo v1

| Step Type | Responsabilidad | Resultado |
|---|---|---|
| `send_message` | Producir un command bloqueante con contenido/template fijado; v1 usa `ON_EFFECT_TERMINAL`. `requested` significa aceptación/deduplicación confirmada por el adapter, no entrega al destinatario. | `requested`, `failed` |
| `collect_input` | Esperar input correlacionado y opcional timeout. | `received`, `invalid`, `expired` |
| `present_options` | Opciones canónicas adaptables al canal. | `selected`, `invalid`, `expired` |
| `receive_media` | Esperar media y solo exponer referencia `CLEAN`. | `received`, `invalid`, `expired`, `quarantined` |
| `set_variable` | Escribir solo `userVariables`. | `completed` |
| `condition` | Evaluar AST seguro versionado. | rama nombrada |
| `execute_action` | Producir command para action registrada y esperar su resolución durable. | `succeeded`, `business_error`, `technical_error` |
| `wait` | Carrera de un evento correlacionado contra un timer. | `event_received`, `elapsed`, `cancelled` |
| `human_handoff` | Iniciar saga y transferir autoridad. | `active`, `resumed`, `closed`, `failed` |
| `end` | Terminar el run. | ninguno |

No existe `invoke_subflow` en v1. Tampoco step types con nombres de negocio. La Action Registry, no el catálogo, contiene integraciones tipadas.

Cada descriptor fija schema, output, transiciones, handler version, pureza, sensibilidad, commands posibles y `completionMode: ON_PERSIST | ON_EFFECT_TERMINAL`. `ON_PERSIST` puede emitir solo commands no bloqueantes y produce un outcome explícito `persisted`; `ON_EFFECT_TERMINAL` crea la continuation de §11.4. El compilador rechaza cualquier activación capaz de emitir más de un command bloqueante. Frontend y backend consumen el mismo descriptor publicado.

---

## 8. Máquinas de estado normativas

Toda transición inválida se rechaza con CAS y auditoría. Los estados terminales no tienen salidas salvo operaciones administrativas que crean nuevos objetos.

### 8.1 Flow y Flow Version

| Estado Flow | Transiciones permitidas | Efecto |
|---|---|---|
| `DRAFT_ONLY` | `ACTIVE`, `ARCHIVED` | `ACTIVE` exige publicación válida. |
| `ACTIVE` | `PAUSED`, `DRAINING`, `ARCHIVED` | Acepta nuevas entradas. |
| `PAUSED` | `ACTIVE`, `DRAINING`, `ARCHIVED` | Semántica exacta en §9. |
| `DRAINING` | `PAUSED`, `ARCHIVED` | No entradas; deja completar trabajo permitido. |
| `ARCHIVED` | ninguno en v1 | No entradas ni edición; historial retenido. |

Flow Version: `DRAFT → PUBLISHED`; `PUBLISHED → SUPERSEDED` solo cambia metadata de selección, no snapshot; `DRAFT → ABANDONED`. Rollback crea una nueva `PUBLISHED`.

### 8.2 Run

| Estado | Transiciones permitidas |
|---|---|
| `RUNNING` | `WAITING_INPUT`, `WAITING_EVENT`, `WAITING_TIMER`, `WAITING_EFFECT`, `HANDOFF_REQUESTED`, `COMPLETED`, `FAILED`, `BLOCKED_DEPENDENCY`, `CANCEL_REQUESTED` |
| `WAITING_INPUT/EVENT/TIMER` | `RUNNING`, `CANCEL_REQUESTED`, `BLOCKED_DEPENDENCY` |
| `WAITING_EFFECT` | `RUNNING`, `FAILED`, `CANCEL_REQUESTED`, `BLOCKED_DEPENDENCY` |
| `HANDOFF_REQUESTED` | `HANDED_OFF`, `RUNNING`, `FAILED`, `CANCEL_REQUESTED` |
| `HANDED_OFF` | `RUNNING`, `COMPLETED`, `CANCEL_REQUESTED` |
| `BLOCKED_DEPENDENCY` | `RUNNING`, `CANCEL_REQUESTED` |
| `CANCEL_REQUESTED` | `CANCELLED`, `CANCEL_BLOCKED` |
| `CANCEL_BLOCKED` | `CANCEL_REQUESTED`, `FAILED` |
| `COMPLETED`, `FAILED`, `CANCELLED` | ninguna |

`WAITING_EFFECT → RUNNING/FAILED` solo ocurre al consumir la resolución terminal mediante §11.4. Ningún run puede entrar a `COMPLETED`, `FAILED` o `CANCELLED` mientras tenga effects `DISPATCHING/UNKNOWN/RECONCILING/MANUAL_REVIEW` o continuations/resume jobs no consumidos; un fallo puramente interno solo llega a `FAILED` si esos conteos son cero. Esto también guarda `CANCEL_BLOCKED → FAILED` y evita usar `FAILED` para saltar la resolución. Cancelar no revierte efectos confirmados. Si una action requiere compensación, se ejecuta como nuevo efecto lógico explícito, sensible y auditable; no existe compensación genérica.

### 8.3 Inbox y Job

Inbox:

```text
RECEIVED → CLAIMED → PROCESSED
                  ├→ RETRYABLE → CLAIMED
                  ├→ FAILED
                  └→ QUARANTINED
```

`CLAIMED` tiene lease; al expirar vuelve a `RETRYABLE`. `PROCESSED/FAILED/QUARANTINED` son terminales. No se reabre ni reutiliza el job original.

Job:

```text
AVAILABLE → LEASED → SUCCEEDED
                   ├→ RETRY_WAIT → AVAILABLE
                   ├→ DEAD_LETTER
                   └→ CANCELLED
```

Un lease vencido no crea otro job: habilita reclaim del mismo row. El job original tiene constraint único `(inbound_event_id, job_kind, replay_ordinal=0)`.

En v1, **replay es exclusivamente diagnóstico y side-effect-free**. Una entidad `ReplayRequest`, creada por `automation.operate`, guarda motivo, actor, scope, `sourceInboundEventId`, `sourceFlowRunId` opcional, `replayOrdinal` monotónico asignado bajo lock y snapshot/hash de la solicitud. La unicidad es `(source_inbound_event_id, replay_ordinal)` en requests y `(source_inbound_event_id, job_kind, replay_ordinal)` en jobs; una request materializa exactamente un job `PROCESS_INBOUND_REPLAY` y un `ReplayReport`. No crea `DerivedInboundEvent`, `conversationSequence`, Flow Run, Step Activation, Command, Effect Ledger ni Handoff; no reabre objetos terminales.

El worker ejecuta normalización, selección de binding, compilación y engine únicamente mediante el composition root de simulación de §5.4, fijado a los snapshots originales disponibles. Todo command candidato termina en `RecordingEffectSink` y se compara con el ledger/origen mediante `logicalEffectId`, pero nunca se despacha ni consume outcomes productivos. Si falta un snapshot o dependencia compatible, el reporte queda `INCOMPLETE/BLOCKED_DEPENDENCY`; no hace fallback a `latest`. Reparar un inbox/run no terminal usa su retry/reclaim normal, no replay. Volver a producir un efecto o reabrir un run terminal es una **re-ejecución administrativa** distinta, sensible y fuera de v1. El oráculo exige dos requests concurrentes con ordinal solicitado igual: una request, un job y un report; dos ordinals distintos: dos reports, cero nuevos sequences/runs/effects y cero I/O externo.

### 8.4 Effect Ledger

```text
PENDING → AUTHORIZED → DISPATCHING → CONFIRMED
   ├───────────────→ CANCELLED_BEFORE_DISPATCH
   └→ DENIED
AUTHORIZED ────────→ CANCELLED_BEFORE_DISPATCH
DISPATCHING → RETRY_WAIT → AUTHORIZED
            ├→ UNKNOWN → RECONCILING → CONFIRMED
            │                       ├→ NOT_APPLIED → AUTHORIZED
            │                       └→ MANUAL_REVIEW
            ├→ FAILED_PERMANENT
            └→ MANUAL_REVIEW
MANUAL_REVIEW → CONFIRMED
              ├→ NOT_APPLIED → AUTHORIZED
              └→ FAILED_PERMANENT
```

`CONFIRMED`, `DENIED`, `FAILED_PERMANENT` y `CANCELLED_BEFORE_DISPATCH` son terminales. Esta última solo se alcanza por CAS desde `PENDING/AUTHORIZED`, nunca desde `DISPATCHING`, y guarda actor, motivo y observation estructurada de cero dispatch. En la misma transacción marca `CANCELLED` cualquier continuation asociada aún no materializada. `NOT_APPLIED` es una resolución probada y auditada, no terminal: permite un nuevo intento solo por la policy fijada. `UNKNOWN`, `RECONCILING` y `MANUAL_REVIEW` son bloqueantes y jamás reanudan el flow ni se convierten en `technical_error`/otro outcome por timeout. Una salida de `MANUAL_REVIEW` es una resolución autorizada con actor, rol, motivo y evidencia; requiere four-eyes para efectos sensibles. Cada transición guarda observation, adapter guarantee y actor/attempt.

### 8.5 Handoff saga

```text
REQUESTED → PROVISIONING → ACTIVE → RESUME_REQUESTED → CLOSED
          ├→ FAILED       └→ CLOSE_REQUESTED ─────────→ CLOSED
          └→ MANUAL_REVIEW
```

- Al crear `REQUESTED`, Conversation cambia autoridad `BOT → NONE` en la misma transacción.
- Al confirmar el destino, pasa a `ACTIVE` y autoridad `NONE → HUMAN_INBOX`.
- Si falla antes de confirmar, reconciliación decide `FAILED` y devuelve autoridad a `BOT`, o `MANUAL_REVIEW` con `NONE`.
- Solo un evento autenticado y autorizado según policy puede crear `RESUME_REQUESTED`; tras cierre/reconciliación, autoridad pasa `HUMAN_INBOX → BOT` y el run reanuda.
- `externalConversationKey = conversationId + handoffOrdinal` es estable en retries y el adapter debe deduplicarlo o reconciliarlo.
- Mientras autoridad no sea `BOT`, los commands automáticos de respuesta se deniegan; los eventos inbound se conservan y se sincronizan al dueño actual.

---

## 9. Pause, drain, cancel y rollback

### 9.1 Matriz normativa

| Operación/estado | Nuevas entradas | Eventos que reanudan | Timers | Retries técnicos sin efecto incierto | Ledger `PENDING/AUTHORIZED` | Ledger `DISPATCHING/UNKNOWN/RECONCILING/MANUAL_REVIEW` | Handoff activo |
|---|---|---|---|---|---|---|---|
| Flow `ACTIVE` | Sí | Sí, en secuencia | Sí | Sí | Sí | Reconciliar según adapter | Continúa bajo autoridad humana |
| Flow `PAUSED` | No | Se persisten, jobs quedan `AVAILABLE` pero no se reclaman | No se disparan; conservan deadline | No | No se despachan | **Sí se reconcilian**, nunca se abandonan | Continúa; no se devuelve autoridad automáticamente |
| Flow `DRAINING` | No | Sí para runs existentes | Sí | Sí | Sí | Reconciliar | Continúa hasta cierre/reanudación |
| Flow `ARCHIVED` | No | No; cuarentena operativa | No | No | No | No puede entrar a `ARCHIVED` hasta resolución terminal | Handoff debe estar `CLOSED/FAILED` antes de archivar |
| Run `CANCEL_REQUESTED` | N/A | No | Se cancelan por CAS | Solo reconciliación/compensación explícita | Se cancelan si no hubo dispatch | Reconciliar; puede causar `CANCEL_BLOCKED` | Solicitar cierre; autoridad `NONE` hasta confirmación |
| Kill switch adapter/action | No afecta routing salvo switch de flow | Sí, pero command bloqueado | Sí | No para target bloqueado | Queda retenido | Reconciliar solo si hacerlo no repite el efecto; si no, manual | Según switch específico |

`PAUSED` es freeze de automatización y detiene daño nuevo, pero **no puede detener una solicitud ya aceptada externamente**; por eso siempre permite reconciliar `DISPATCHING/UNKNOWN/RECONCILING` y conservar `MANUAL_REVIEW` bloqueante. Los mensajes entrantes nunca se descartan.

La transición `CANCEL_REQUESTED → CANCELLED` tiene guards obligatorios comprobados en una transacción bajo lock del run/conversation: cero handoffs externos abiertos (`REQUESTED/PROVISIONING/ACTIVE/RESUME_REQUESTED/CLOSE_REQUESTED/MANUAL_REVIEW`), cero effects `DISPATCHING/UNKNOWN/RECONCILING/MANUAL_REVIEW`, cero effect continuations/resume jobs no consumidos y cero timers/jobs reclamables. También exige que todo ledger `PENDING/AUTHORIZED` haya ganado por CAS la transición `CANCELLED_BEFORE_DISPATCH` y que su continuation haya quedado `CANCELLED` en el mismo commit. La carrera cancel-vs-dispatch usa el mismo row/version: exactamente uno de `AUTHORIZED → CANCELLED_BEFORE_DISPATCH` o `AUTHORIZED → DISPATCHING` puede ganar; si gana cancelación hay cero I/O, y si gana dispatch el run queda `CANCEL_BLOCKED` hasta resolución. Si cualquier guard falla, la única transición permitida es `CANCEL_BLOCKED`; no hay override para marcar terminal. El cierre/reconcile autorizado vuelve a evaluar los guards y recién entonces puede solicitarse nuevamente cancelación.

### 9.2 Rollback

Rollback crea y activa una nueva versión con manifest basado en un snapshot anterior y dependencias todavía compatibles. Solo afecta nuevos runs. No migra ni modifica runs activos. Si el defecto afecta runs activos, el operador elige:

1. `DRAINING` si completar la versión fijada es seguro;
2. `PAUSED` para investigar;
3. cancelación explícita por run/lote con dry-run y aprobación sensible cuando existan efectos;
4. restaurar la implementación compatible si hay `BLOCKED_DEPENDENCY`.

No existe “rollback de efectos”. Una compensación es una action separada con su propio `logicalEffectId`, autorización y prueba.

### 9.3 Migración y borrado

Migración de runs activos está **prohibida en v1**. No hay endpoint ni operación DB soportada. El borrado operativo aplica TTL por copia (§13), pero no borra snapshots, ledger mínimo ni auditoría exigida. Archivo solo se permite cuando no hay runs no terminales, handoffs activos, jobs reclamables ni effects/continuations sin resolución. `MANUAL_REVIEW` no es excepción terminal: debe resolverse de forma autorizada antes de archivar.

---

## 10. Protocolo transaccional inbox → job → run

### 10.1 Aceptación

Dentro de una única transacción Postgres:

1. insertar/deduplicar inbox por `(provider, account_id, external_event_id)`;
2. resolver/crear Conversation y tomar `SELECT ... FOR UPDATE` sobre ella;
3. asignar `conversationSequence = lastSequence + 1` (monotónico interno, no timestamp del proveedor);
4. insertar exactamente un Job `AVAILABLE` con constraint `(inbound_event_id, PROCESS_INBOUND, replay_ordinal=0)`;
5. commit; solo después responder 2xx.

Si el evento es duplicado, no se crea otro sequence/job y se responde un **2xx idempotente** con el `inboundEventId` y status actualmente persistido de la fila original. No se promete conservar ni reproducir los bytes de la respuesta HTTP original. Un reconciliador periódico busca inbox no terminal sin job, que representa violación, alerta y materializa solo bajo el mismo constraint; la prueba normal exige que esta ruta no sea necesaria.

### 10.2 Consumo ordenado

El worker reclama Job con `FOR UPDATE SKIP LOCKED`, pero antes de avanzar:

1. toma lease del job;
2. toma lock/CAS de Conversation;
3. verifica que su sequence sea el menor no terminal;
4. resuelve binding o run activo bajo el mismo lock;
5. crea/reanuda como máximo un run automatizado;
6. ejecuta engine puro;
7. persiste nuevo run state, step activation, commands en Effect Ledger y jobs/timers en la misma transacción;
8. marca inbox `PROCESSED` y job `SUCCEEDED` solo si todo committea.

Si el worker descubre que su sequence no es el menor no terminal, en la misma transacción libera el lease (`LEASED → AVAILABLE`), limpia `leasedAt/leaseUntil/leasedBy` y fija `available_at` a un backoff acotado con jitter, máximo 1 s o el menor deadline anterior; no espera el lease timeout. Alternativamente, una implementación puede reclamar mediante una query equivalente que solo seleccione de antemano el menor sequence. La prueba con sequences 1 bloqueado y 2..100 reclamados exige que 2..100 queden `AVAILABLE`, sin owner, en ≤1 s y que ninguno avance.

Eventos posteriores permanecen disponibles pero no avanzan. Eventos del proveedor tardíos se ordenan por recepción interna; metadata de timestamp/sequence externa se conserva para policy. Un evento que semánticamente ya expiró sigue una transición explícita `late_event` o cuarentena; nunca reordena historia. Empates son imposibles por sequence transaccional.

### 10.3 Locks y límites

- Lock principal: row de Conversation; `lockVersion` provee CAS adicional.
- Unique parcial: máximo un run en estados no terminales por Conversation.
- Leases tienen `leasedAt`, `leaseUntil`, `leasedBy`; heartbeat acotado y reclaim seguro.
- Un worker no mantiene transacción DB durante I/O externo. Los commands se despachan después desde ledger.

---

## 11. Efectos, idempotencia y outbox

### 11.1 Identidades

```text
logicalEffectId = H(flowRunId, stepId, activationOrdinal, commandKind, commandOrdinal)
executionAttemptId = UUIDv7() por cada intento de dispatch/reconcile
```

`logicalEffectId` se calcula con encoding canónico y no incluye intento, job, worker ni timestamp. Todos los retries y reconciliaciones del mismo efecto conservan exactamente el mismo ID.

El ledger almacena como mínimo:

- `logical_effect_id` unique;
- run/step/activation/command ordinal;
- command kind, adapter y descriptor version;
- canonical payload cifrado o referencia, `payload_hash` y clasificación;
- estado de §8.4;
- garantía declarada: `RECEIVER_DEDUP`, `RECONCILABLE`, `AT_LEAST_ONCE`, `AT_MOST_ONCE`, `MANUAL_ON_AMBIGUITY`;
- policy decision/hash;
- attempts con `execution_attempt_id`, timestamps, request hash, `dispatchOwnerId`, `dispatchLeaseUntil`, heartbeat y observation;
- external refs, receipt/webhook correlation y resultado final.

Insertar el mismo `logicalEffectId` y hash es idempotente; hash distinto es error fatal de determinismo.

### 11.2 Dispatch y ambigüedad

Antes del I/O, una transacción corta hace CAS `AUTHORIZED → DISPATCHING`, crea attempt y fija `dispatchOwnerId` y `dispatchLeaseUntil` posterior al timeout externo máximo. Solo el owner puede registrar heartbeat o respuesta; el heartbeat usa CAS por attempt, no puede extender más allá del budget/deadline versionado y se detiene antes de I/O no acotado. Después del I/O se registra observación mediante CAS del mismo attempt. Timeout, conexión rota tras envío o respuesta ilegible producen `UNKNOWN`, no retry inmediato.

Un scavenger durable reclama attempts `DISPATCHING` cuyo `dispatchLeaseUntil < now`, verifica por CAS que estado, owner, attempt y lease no cambiaron y ejecuta obligatoriamente `DISPATCHING → UNKNOWN`; jamás vuelve directo a `AUTHORIZED`, `RETRY_WAIT` ni crea otro execute. Luego materializa/reclama reconciliación y hace `UNKNOWN → RECONCILING` conforme al descriptor fijado. Un heartbeat concurrente que ganó CAS impide el scavenging; un owner perdido no puede escribir después de que cambió el attempt/state. El crash exacto después de que el receptor aplica I/O y antes de persistir respuesta tiene oráculo: una fila ledger, un attempt, estado inicial `DISPATCHING`; al vencer lease, exactamente una transición a `UNKNOWN`, luego `RECONCILING`, cero segundo execute y resolución por observation/webhook/manual según contrato.

Cada descriptor de adapter/action DEBE declarar una estrategia probada:

| Capacidad del receptor | Garantía y respuesta a `UNKNOWN` |
|---|---|
| Deduplica por key estable | Reintentar con el mismo `logicalEffectId`; verificar que payload hash coincida. |
| Permite consulta por client reference | Reconciliar primero; reintentar solo si confirma `NOT_APPLIED`. |
| Emite webhook correlacionable | Esperar/reconciliar dentro de deadline; después manual review. |
| No deduplica ni permite consulta | Elegir por command `AT_MOST_ONCE` o `AT_LEAST_ONCE` mediante decisión aprobada; en acciones sensibles, `MANUAL_ON_AMBIGUITY` obligatorio. |

La garantía de Meta, Chatwoot y cada action se documenta en su dependency manifest y contract test. No se afirma que el outbox evite duplicados por sí solo.

### 11.3 Reconciliación

Un reconciler reclama ledger `UNKNOWN/RECONCILING` con lease, usa únicamente adapter, versión, implementation compatibility ID y environment snapshot fijados y guarda evidencia. Solo se ejecuta automáticamente si `reconcileMode` es `READ_ONLY` o `WEBHOOK_ONLY`; `MUTATING` pasa a `MANUAL_REVIEW` sin invocación. Deadlines y número de intentos son policy versionada. Si no se conoce el resultado, pasa a `MANUAL_REVIEW`, alerta y bloquea la transición dependiente. `UNKNOWN`, `RECONCILING` y `MANUAL_REVIEW` no son outcomes consumibles. Una corrección manual requiere actor, permiso `automation.reconcile`, motivo, evidence ref opaca y, para efectos sensibles, aprobación dual; solo puede resolver a `CONFIRMED`, `NOT_APPLIED` o `FAILED_PERMANENT`.

### 11.4 Continuation durable y reanudación

Cuando el engine emite el único command bloqueante permitido para una activación `ON_EFFECT_TERMINAL`, el coordinator, **en la misma transacción** que inserta/verifica el ledger, persiste el run como `WAITING_EFFECT` y crea `EffectContinuation` con:

- `effectContinuationId = H(flowRunId, stepId, activationOrdinal, commandOrdinal)` y esos cuatro componentes;
- `awaitedLogicalEffectId` y `expectedPayloadHash`;
- `outcomeMappingVersion` fijado en el manifest;
- mapping exhaustivo de resultados consumibles a outcomes del descriptor;
- estado `WAITING | MATERIALIZED | CONSUMED | CANCELLED`, `materializedAt`, `consumedAt` y `resumeJobId` nullable.

`effect_continuation_id`, `(flow_run_id, step_id, activation_ordinal)` y `awaited_logical_effect_id` son unique para continuations bloqueantes; no existe ordinal libre que permita duplicarlas. El mapping es compilado y total para `CONFIRMED`, `DENIED` y `FAILED_PERMANENT`, y puede discriminar un `businessResultCode` versionado dentro de una observation confirmada. Para `execute_action`, `CONFIRMED` mapea a `succeeded` o a un `business_error` explícito según descriptor; `DENIED` y fallos técnicos terminales mapean a `technical_error` salvo que el descriptor declare un outcome no sensible más específico. Para `send_message`, aceptación/deduplicación confirmada mapea a `requested`, y `DENIED/FAILED_PERMANENT` a `failed`; no significa lectura ni entrega. No existe mapping para `UNKNOWN`, `RECONCILING` o `MANUAL_REVIEW`. `NOT_APPLIED` autoriza retry y tampoco reanuda. `CANCELLED_BEFORE_DISPATCH` cancela la continuation y no reanuda porque el run ya está cancelándose.

Cada transición que haga terminal/consumible el ledger —respuesta síncrona, webhook, reconciler o resolución manual— llama al mismo materializador. En una única transacción toma lock/CAS del ledger, continuation, run y conversation; verifica que el run siga `WAITING_EFFECT`, que `awaitedLogicalEffectId/payloadHash` coincidan y que el estado sea consumible; inserta exactamente un job `RESUME_EFFECT` con unique `(effect_continuation_id)` y guarda `materializedAt/resumeJobId`. Si ya existe, retorna idempotentemente. El worker de resume toma los mismos locks, aplica una sola vez el mapping mediante `engine.resume`, persiste activations/commands/nuevo state y marca `consumedAt` y job `SUCCEEDED` en el mismo commit. Un crash/rollback deja todos esos cambios ausentes o todos presentes; el reconciliador de invariantes vuelve a materializar una continuation consumible sin job bajo la misma unique key.

Pruebas de fault injection cortan antes/después de: persistir `WAITING_EFFECT+ledger+continuation`, confirmación síncrona, webhook, CAS de reconcile/manual resolution, insert del resume job, `engine.resume` y commit. Webhook y reconciler concurrentes más 20 workers deben producir exactamente una continuation con el ID derivado, un resume job, un `consumedAt` y una activación siguiente; recomputar la misma transición conserva el ID y no duplica. El compilador rechaza dos commands bloqueantes en una activación. Un estado ambiguo produce cero resume jobs hasta resolución terminal autorizada.

---

## 12. Actions, policies y handoff

### 12.1 Action Registry

Cada descriptor declara clave/versiones, schemas, compatibilidad, sensibilidad, data lineage, permiso, assurance requerido, timeout, retry, garantía de efecto, reconciliador y su `reconcileMode`, outcome mapping exhaustivo/versionado, campos redactables, ambientes y kill-switch key.

No existe HTTP genérico. Las actions mutating requieren precondiciones, `logicalEffectId`, receptor deduplicable o reconciliación/manual review, auditoría y resultado verificable. La acción no recibe credenciales desde el flow.

### 12.2 Handoff y Chatwoot

Chatwoot es adapter humano, no fuente de verdad financiera ni autoridad de lifecycle. La definición usa propósito/cola lógica; configuración ambiental resuelve inbox/team. La saga de §8.5 conserva mensajes y evita doble respuesta. Eventos de agente se normalizan con identidad autenticada y tipo canónico; eventos no soportados se guardan pero no reanudan el run.

Chatwoot cloud vs autohospedado y el conjunto exacto de PII son decisiones abiertas; hasta aprobarlas, el adapter solo recibe identificador opaco y resumen no sensible allowlisted.

---

## 13. Seguridad, PII, medios y secretos

### 13.1 Inventario de PII por copia

Antes de crear tablas, el data owner aprueba un catálogo campo-por-campo. Baseline obligatorio:

| Copia/tabla | Contenido permitido | Cifrado/acceso | TTL baseline propuesto | Backup/borrado |
|---|---|---|---|---|
| `inbound_events` | Envelope allowlisted; payload crudo solo cuarentena diagnóstica | Envelope encryption; runtime mínimo | Crudo 7 días; canónico 90 días | Expira también de backups al vencer ventana de backup; tombstone auditable |
| `conversations/messages` | IDs opacos, tipo, copy necesario | Column/envelope para teléfono/contenido; RBAC | 180 días | Restore job reaplica tombstones |
| `flow_runs/context` | `userVariables` mínimas; claims por refs | Envelope por run; audit de decrypt | 180 días tras terminal | Crypto-erasure de DEK; backups sujetos a RPO/retención |
| `step_runs/action_results` | Diagnóstico redactado; no response cruda por defecto | Campos sensibles cifrados | 90 días | Resultado financiero mínimo se separa al ledger |
| `jobs/errors` | IDs/códigos; sin contenido o tokens | DB encryption + redacción irreversible | 30 días terminal | Purga/partición |
| `effect_ledger/outbox payload` | Hash + payload mínimo/referencia | Envelope; acceso operador restringido | Ledger mínimo según obligación; payload 180 días baseline | Hash/auditoría permanecen, payload crypto-erased |
| `trusted_claims/evidence refs` | Claim mínimo, issuer/método y referencia opaca; nunca evidencia libre/cruda | Rol system-owned; campos cifrados; decrypt auditado | Vigencia del claim + 90 días baseline | Revocación/tombstone; evidencia separada sigue TTL propio |
| `effect_continuations/replay_requests` | IDs, mapping/status, actor y motivo estructurado redactado | RBAC operator; sin payload copiado | 180 días tras terminal baseline | Crypto-erasure de comentarios; IDs/hash mínimos retenidos |
| `handoffs/reconcile observations` | Estados/códigos y external/evidence refs opacas | Envelope; acceso support/reconcile | 180 días tras cierre baseline | Borrado coordinado con proveedor y tombstone tras restore |
| `manual_resolutions` | Actor, decisión, motivo codificado y evidence ref opaca; no evidencia cruda | RBAC reconcile + four-eyes sensible | Retención legal a aprobar | Evidencia en store separado con TTL/access propios |
| `publication_approvals/comments` | Actor, hashes y comentario redactado/estructurado | RBAC publish/audit | Retención legal a aprobar | PII innecesaria se elimina/crypto-erases sin alterar hashes de decisión |
| `audit_log/diffs` | Patches estructurales redactados | Append-only; acceso audit | Retención legal a aprobar | No incluir PII innecesaria |
| `media quarantine/R2 clean` | Blob y metadata mínima | Buckets privados y claves opacas | Cuarentena 24 h; clean 30 días baseline | Lifecycle + tombstone tras restore |
| Chatwoot | Solo allowlist aprobada | Según contrato/DPA y RBAC | Alinear al mínimo entre sistemas | API de borrado + evidencia |
| Logs/traces/metrics | IDs y códigos; no bodies/context | Acceso observabilidad | 30 días baseline | Excluir de backups largos |

Los TTL son **PROPOSED** hasta aprobación del Data Protection Owner; una tabla no puede entrar a producción sin valor aprobado. Claims, external refs, evidence refs, observaciones de handoff/reconcile, resolución manual y comentarios de aprobación se consideran copias PII potenciales aunque sean metadata. DEBEN usar referencias opacas y campos estructurados cuando sea posible; evidencia libre/cruda está prohibida en estas tablas y solo puede residir en un store separado con owner, acceso, cifrado y TTL aprobados. La documentación del backup DEBE indicar cifrado, retención, quién restaura, cómo reaplica tombstones y cuándo una copia expirada es físicamente inaccesible. Se audita cada decrypt/descarga administrativa. Está prohibido reutilizar logging que escriba request/response completo.

### 13.2 Secretos y webhooks

Firmas obligatorias, compare constante, límites de body/rate, logs redactados y secret manager. Definitions/manifests solo contienen `secretRef`; UI nunca lee valores. Rotar un secreto no cambia semántica del flow, pero queda auditado y puede activar kill switch si falla.

### 13.3 Pipeline de medios

Para media de Meta:

1. validar firma del webhook y media reference;
2. resolver URL exclusivamente mediante API oficial;
3. permitir host, esquema, puerto, redirect y rangos IP conforme a allowlist Meta; resolver DNS mediante resolver controlado, validar todas las IP A/AAAA y fijar la IP elegida al socket/TLS conservando hostname/SNI; revalidar y volver a fijar DNS en **cada** redirect y nueva conexión; rechazar si cualquier resolución o cambio alcanza IP privada, loopback, link-local, multicast, CGNAT, metadata o rango no allowlisted. No se reutiliza una conexión cuya IP no coincide con la validada;
4. descargar en streaming con timeout y límites fijados por el manifest; defaults máximos mientras Security no apruebe otros: 3 redirects, 25 MiB comprimidos/transferidos, 100 MiB expandidos, ratio de expansión 20×, profundidad de archivo 3, 1,000 entries y 100 MiB agregados; nunca buffer completo;
5. calcular hash y detectar magic bytes; MIME declarado, extensión y firma deben ser compatibles;
6. escribir en bucket/namespace `QUARANTINE` privado con clave opaca;
7. ejecutar antimalware/parser en sandbox sin red con límites máximos 512 MiB memoria, 30 s CPU y 60 s wall-clock por objeto; matar el proceso completo y marcar `ERROR` al exceder memoria, CPU, tiempo, profundidad, entries o expansión; registrar engine/signature version y motivo;
8. solo resultado `CLEAN` se promueve/copia a namespace disponible; `INFECTED/ERROR/UNKNOWN` no es accesible al flow;
9. URLs firmadas cortas y acceso auditado; TTL/lifecycle conforme inventario.

**Antimalware es requisito previo a cualquier piloto que acepte documentos o imágenes no confiables.** Si no está operativo, `receive_media` y bindings de media permanecen deshabilitados. No se reutiliza un fetch genérico de URL/R2 como implementación de este pipeline.

---

## 14. Postgres queue: condición, capacidad y extracción

Postgres queue/JSONB son decisiones v1 condicionales, no garantías universales. Baseline **PROPOSED y verificable en staging**:

| Objetivo | Valor provisional |
|---|---:|
| Inbound sostenido | 20 eventos/s |
| Burst de 5 minutos | 100 eventos/s |
| Jobs pendientes operables | 100,000 |
| Payload medio job | ≤ 8 KiB; blobs fuera de DB |
| Inicio de procesamiento | p95 ≤ 5 s, p99 ≤ 15 s bajo baseline |
| Edad máxima normal del job más antiguo | < 60 s |
| Retención jobs terminales hot | 7 días, luego partición/archivo/purga |
| Lease | 30 s, configurable y menor que timeout máximo |
| Workers iniciales | 2–8 con fairness por account/conversation |

Mecanismos obligatorios: índices parciales sobre estados reclamables y `available_at`; `FOR UPDATE SKIP LOCKED`; leases/reclaim; unique constraints; selección fair por cuenta; partición de históricos; autovacuum/analyze monitoreado; payloads grandes fuera de queue; límites globales y por adapter; backpressure y circuit breakers.

Se abre decisión de extracción a worker/cola dedicada si cualquiera se mantiene durante 15 minutos en dos ventanas de una hora, o si una prueba al 2× baseline falla:

- p95 de inicio > 10 s o p99 > 30 s;
- job oldest age > 120 s;
- backlog > 250,000;
- DB CPU > 70% atribuible a queue o lock wait p95 > 100 ms;
- bloat de tablas/índices queue > 30% y autovacuum no recupera;
- queue degrada p95 de transacciones CRM > 10%.

Owner de capacidad registra el benchmark, plan SQL, hardware, volumen, VACUUM y decisión. Redis u otro broker no se introduce antes de medir ni después de superar umbral sin plan aprobado.

---

## 15. Operabilidad, SLO y recuperación

### 15.1 SLI/SLO provisionales para piloto

| SLI | SLO mensual propuesto | Alerta |
|---|---|---|
| Webhooks válidos persistidos y con job en transacción | 99.95% | cualquier invariant violation; error rate > 1% por 5 min |
| Latencia aceptación webhook | p95 ≤ 500 ms, p99 ≤ 1 s | p95 > 1 s por 10 min |
| Inicio de job bajo baseline | p95 ≤ 5 s, p99 ≤ 15 s | §14 |
| Effects fuera de estado ambiguo dentro de deadline policy | 99.9% | cualquier sensible `UNKNOWN` > 5 min; otros > 15 min |
| Runs no bloqueados por dependencia desplegada | 99.99% | cualquier `BLOCKED_DEPENDENCY` |
| Autoridad doble BOT/HUMAN | 0 casos | inmediata |
| Medios servidos sin `CLEAN` | 0 casos | inmediata y kill switch media |

RPO **PROPOSED:** **≤5 minutos para todo Postgres, incluido Effect Ledger**; por tanto puede perderse estado local confirmado dentro de esa ventana y no se promete cero pérdida del ledger. Para blobs clean reproducibles/no críticos, 24 horas. RTO **PROPOSED:** 60 minutos para aceptación/cola y 4 horas para editor/reporting. Deben aprobarse por Platform Owner y Business Continuity antes del piloto.

Antes de habilitar cualquier adapter/account/destino capaz de dispatch, el control plane escribe de forma síncrona un registro firmado en un **Dispatch Scope Journal append-only fuera de la misma ventana/failure domain de Postgres** —R2 con Object Lock/versioning o servicio equivalente aprobado— con `scopeGeneration`, adapter/account/destinos físicos no secretos, environment snapshot hash, `enabledAt/disabledAt` y hash de configuración. Sin acuse durable del journal el scope permanece bloqueado. El journal retiene generaciones por más que el RPO y es la fuente recuperable del universo máximo que pudo despachar; una réplica Postgres es solo índice. Secretos no se copian. Su propia recuperación, integridad, acceso y retención se prueban antes del piloto.

Después de cualquier restore, dispatch mutating permanece globalmente bloqueado. El sistema calcula la ventana incierta desde el último recovery point verificable hasta el corte, reconstruye el scope máximo desde Dispatch Scope Journal —incluidas cuentas/snapshots creados y luego perdidos completamente dentro del RPO— y consulta cada receptor por client reference/webhook/export. Adapters `READ_ONLY/WEBHOOK_ONLY` pueden reconciliar. Si el journal no está íntegro/disponible, o el proveedor no permite enumerar/consultar, o la correlación no es concluyente, el switch global o del scope afectado **no puede levantarse**; se materializa un caso `MANUAL_REVIEW` de recuperación y no se redispatcha. Solo un recovery owner y, para effects sensibles, un segundo aprobador pueden cerrar la ventana y levantar un scope con evidencia de integridad del journal, inventario, conteos y outcomes. El drill inyecta pérdida de 1–5 minutos, crea dentro de la ventana un scope/snapshot nuevo y effects aplicados externamente, y después elimina sus filas Postgres: exige redescubrir el scope desde el journal, cero redispatch durante incertidumbre, cada candidato en `CONFIRMED`, `NOT_APPLIED` o `MANUAL_REVIEW`, y reconciliación documentada. Para adapters sin export/consulta exhaustiva, el scope permanece bloqueado hasta una decisión manual de continuidad explícita; el spec no promete recuperación automática.

### 15.2 Kill switches y límites

Kill switches auditados y con scope por ambiente para: Flow, binding, adapter Meta, destino Chatwoot, action key/version, action mutating global, dispatch de mensajes, media ingest y worker claim. Activar un switch no borra trabajo; aplica matriz de §9 y dispara runbook.

Límites globales: retry budget por minuto, concurrencia por adapter/action/cuenta, rate limit de Meta, tamaño de definición/contexto/media, transiciones por resume y duración de waits. Exhaustión produce backpressure/estado explícito, no loops.

### 15.3 Runbooks mínimos antes del piloto

1. Pausar daño y decidir drain/cancel.
2. Reconciliar efecto `UNKNOWN` y resolver manualmente con aprobación.
3. Recuperar inbox/job tras crash o lease vencido.
4. Restaurar Postgres, verificar/reconstruir scopes desde Dispatch Scope Journal, mantener dispatch bloqueado, ejecutar reconciliación externa post-restore de §15.1, reaplicar tombstones y verificar hashes de manifests/snapshots.
5. Credencial/adapter caído y rotación de secreto.
6. Backlog/DB saturation y extracción de worker.
7. Handoff atascado o autoridad `NONE`.
8. Medio infectado/fallo de scanner.
9. Dependency version retirada accidentalmente.

Cada runbook tiene owner on-call, comandos read-only de diagnóstico, acciones autorizadas, rollback, criterios de salida y ejercicio trimestral en staging. El calendario on-call queda abierto; no se habilita piloto sin owner nominal.

---

## 16. Pruebas y tres flujos testigo técnicos

### 16.1 Flujos testigo, no alcance de negocio

1. **Lineal:** mensaje versionado → input tipado → condición → fin. Valida edición, manifest, dataflow y version pinning.
2. **Espera/timeout:** espera un evento correlacionado o timer; el ganador por CAS cancela el perdedor. Valida orden, carrera, restart y late event.
3. **Sensible/handoff:** claim fixture system-owned → action sensible fake → handoff fake → reanudación autenticada. Valida policy runtime, aprobación dual, effect ambiguity, saga y autoridad única.

Estos artefactos son fixtures de prueba, no flujos productivos ni definición de Ventas/Cobros. Cualquier primitiva v1 que ninguno necesite se cuestiona; subflows e import/export UI se posponen.

### 16.2 Matriz mecanismo → prueba/oráculo

| Garantía | Mecanismo | Prueba automatizada y oráculo exacto |
|---|---|---|
| Evento aceptado no queda huérfano | inbox+sequence+job en una transacción | crash antes de commit: 0 inbox/0 job; después de commit: 1 inbox/1 job; webhook duplicado: siguen 1/1 y devuelve 2xx con el mismo ID/status persistido. |
| Replay no produce efectos | `ReplayRequest` diagnóstico + composition root de simulación + `ReplayReport` | requests concurrentes del mismo ordinal: 1 request/1 job/1 report; ordinal nuevo: nuevo report, pero 0 derived events, sequences, runs, activations, ledger rows, handoffs o I/O externo; terminal original permanece terminal. |
| Serialización por conversación | lock Conversation + sequence + unique run activo | 8 workers, 100 eventos concurrentes: sequences 1..100 sin huecos, máximo 1 run activo y outputs en ese orden. |
| Sequence posterior no secuestra lease | release/reagenda en transacción o claim mínimo | sequence 1 bloqueado y 2..100 reclamados: 2..100 `AVAILABLE`, owner null en ≤1 s y 0 avances fuera de orden. |
| Efecto lógico estable | unique ledger + ID sin attempt | timeout tras receptor aplica: N attempts con IDs distintos, exactamente 1 `logicalEffectId`, 1 payload hash y conteo receptor conforme contrato. |
| Payload no muta entre retries | canonical hash constraint | reintento con payload distinto: 0 dispatch adicional, run `FAILED`/alerta de corrupción. |
| Ambigüedad no se repite a ciegas | `UNKNOWN → RECONCILING` | fault tras send: próximo paso es reconcile; para sensible no deduplicable: `MANUAL_REVIEW`, 0 segundo execute. |
| Dispatch huérfano converge | dispatch lease/owner/heartbeat + scavenger CAS | crash exactamente post-I/O/pre-observation: `DISPATCHING → UNKNOWN → RECONCILING`, 1 attempt execute, 0 retorno directo a `AUTHORIZED` y owner viejo no puede escribir. |
| Continuation de effect no se pierde/duplica | `WAITING_EFFECT` + ID derivado + máximo un command bloqueante + unique resume materialization | faults/recomputación y webhook/reconcile concurrentes: 1 continuation con mismo ID, 1 resume job, 1 consumo/activación; dos commands bloqueantes no compilan; ambiguo: 0 resume hasta resolución terminal autorizada. |
| Claims no falsificables | repository system-owned + runtime policy | `set_variable(trustedClaims...)` no compila; command/DTO con array inyectado se rechaza; claim expirado/revocado/issuer falso desde repository: 0 attempts externos y ledger `DENIED`. |
| Version reproducible | compiled manifest + environment snapshot fijados | cambiar por separado handler, action, content, ChannelAdapter, HumanInboxAdapter, scanner/pipeline, issuer/verifier/trust-root, codec/ejecutor y destinos account/inbox/team/endpoint; resume, dispatch, reconcile y close del run viejo usan exclusivamente refs/hashes antiguos. |
| Reconcile no repite | `reconcileMode` contractual | en ambigüedad, `READ_ONLY/WEBHOOK_ONLY` hacen 0 requests mutating; `MUTATING` no se invoca, queda `MANUAL_REVIEW` y 0 segundo execute. |
| Simulador aislado | composition root simulation + network deny | fixture ausente falla antes de engine; socket/DNS monkeypatch registra exactamente 0 llamadas; effect sink solo recording. |
| CAS/aprobación | revision/hash CAS + approvals hash-bound | dos editores: segundo write stale = 409; mutar tras aprobar invalida approval; publicación = 0 hasta dos actores distintos. |
| Borrado seguro | dataflow/dominancia | quitar inicializador/dominador de claim/efecto: compilación falla con paths concretos; 0 auto-reconnect. |
| Pause/drain/cancel | matriz, `CANCELLED_BEFORE_DISPATCH` y guards obligatorios | parametrizada por cada celda; carrera cancel-vs-dispatch: exactamente un CAS gana, si cancela hay 0 I/O y continuation `CANCELLED`, si despacha fuerza `CANCEL_BLOCKED`; solo cero pendientes permite run `CANCELLED`. |
| No migración | ausencia de transición + FK manifest | intento API/DB soportado: rechazo; `flowVersionId` no cambia. |
| Handoff autoridad única | saga + authority CAS | crash en cada borde: ≤1 external conversation, nunca BOT y HUMAN simultáneos, mensajes conservados. |
| JSON/hashes estables | RFC 8785 + envelopes/codecs + DB guard | golden de definition/manifest/environment/promotion/policy/payload/request; maps equivalentes, bytes/fechas/listas según §6.1 = mismo hash; forma no canónica se rechaza; UPDATE/DELETE publicado falla. |
| Media segura | quarantine + DNS/IP pinning + sandbox/límites | DNS rebinding, redirect a IP privada, cambio de IP, bomb ratio/profundidad/entries, CPU/memoria/timeout, oversize/polyglot/EICAR: 0 blob `CLEAN`, 0 URL servida y proceso muerto; válido escaneado: 1 clean ref. |
| Queue cumple capacidad | benchmark 2× baseline | p95/p99/backlog/DB dentro de §14; si no, decisión de extracción bloquea piloto. |
| PII minimizada | schema/log interceptors + TTL jobs | fixtures con canaries: 0 canaries en logs/jobs/audit no permitidos; purge elimina copias y restore reaplica tombstones. |
| Restore respeta RPO declarado | Dispatch Scope Journal externo + kill switch + reconcile externo | crear scope/snapshot/effect completamente dentro de 1–5 min perdidos y borrar sus filas Postgres: journal redescubre el scope; 0 dispatch hasta cierre autorizado; candidatos quedan `CONFIRMED`, `NOT_APPLIED` o `MANUAL_REVIEW`; journal corrupto/ausente o proveedor no enumerable impide levantar switch. |

Fault injection ocurre antes/después de cada commit, lease, policy decision, dispatch, respuesta/confirmación, webhook, reconcile/manual resolution, creación y commit del resume job, consumo de continuation, handoff y media promotion. Incluye explícitamente kill post-I/O/pre-observation y carreras scavenger/heartbeat/webhook/reconciler. Tests de integración usan Postgres real efímero y adapters falsos contractuales; no mocks de la transacción bajo prueba.

### 16.3 Criterios de aceptación ejecutables

La plataforma está lista para diseñar flujos cuando CI/staging demuestra:

1. Los tres flujos testigo compilan, simulan y ejecutan.
2. El manifest contiene y fija todas las dependencias de §6.2; ninguna resolución `latest` aparece en runtime.
3. Todas las filas de la matriz §16.2 pasan con fault injection.
4. El benchmark cumple baseline y 2× baseline o existe extracción implementada y vuelta a ejecutar con resultado satisfactorio.
5. Los SLO, dashboards, alertas, kill switches y runbooks tienen owners y se ejercitan.
6. Dependency manifest del ambiente no tiene incompatibilidades.
7. Inventario PII/TTL/backups y mecanismo de claims requerido tienen aprobación.
8. Si media está habilitada, antimalware y casos adversariales pasan; si no, media permanece deshabilitada.
9. Una publicación sensible requiere exactamente dos actores distintos y el hash ejecutado coincide con el aprobado.
10. Reinicios en cada borde transaccional dejan conteos y estados exactos definidos; restores respetan el RPO y protocolo post-restore de §15.1, sin afirmaciones de exactly-once ni durabilidad no sustentadas.

---

## 17. Fases y gates

### Fase 0 — Decisiones y contratos

- aprobar patrones v1, owners, claim issuer mínimo, PII/TTL, SLO/RPO/RTO y garantía por adapter;
- revalidar estructura y RBAC contra `origin/develop`;
- aprobar schemas canónicos y dependency manifest.

Las decisiones se separan por gate; una fecha vencida **no** implica aprobación, sino bloqueo de entrada a la fase:

| Gate bloqueado | Decisión/artefacto obligatorio | Owner | Decision deadline |
|---|---|---|---|
| Entrada a Fase 1 | ADR-05: JSONB/RFC 8785, codec/migradores y DB guards; aprobar schemas de manifest, environment snapshot, continuation y ReplayRequest | Platform Architecture | 2026-08-13 |
| Entrada a Fase 1 | Contratos versionados de TrustedClaimRepository, outcome mapping, adapters/reconcileMode y composition root de simulación | Security + Platform Architecture | 2026-08-13 |
| Entrada a Fase 2 | ADR-04: Postgres queue inicial sustentada por spike/plan de benchmark; no hace falta haber corrido aún carga final | Database/Platform Owner | 2026-08-20 |
| Entrada a Fase 2 | ADR-15 para campos/tablas de Fase 2: clasificación, cifrado, TTL y backup baseline campo-por-campo | Data Protection Owner | 2026-08-20 |
| Entrada a Fase 2 | ADR-18: fuente de grants/roles de servicio y privilegios DB system-owned | Security + CRM Owner | 2026-08-20 |
| Adapter/Fase 3 | ADR-19: garantía y reconcileMode de cada command Meta | Messaging Platform + Risk | antes de implementar dispatch real; máximo 2026-08-27 |
| Handoff/Fase 5 | ADR-16: modalidad Chatwoot y allowlist PII | CX + Security | antes de conectar Chatwoot; máximo 2026-09-10 |
| Piloto/Fase 6 | ADR-17, TTL finales restantes, issuer/métodos concretos, on-call y capacidad/SLO/RTO | owners de §20 | antes de habilitar tráfico piloto; máximo 2026-09-24 |

**Gate de Fase 0:** solo se abre la fase concreta cuando todas sus filas están `APPROVED`, con evidencia/hash y decisión registrada antes de su deadline. Las filas de adapters/piloto no bloquean investigación ni fake adapters en Fase 1/2.

### Fase 1 — Núcleo seguro y simulador

- codecs/migradores/canonical JSON;
- compiler, dataflow/dominancia y manifest;
- pure engine y registries versionados;
- **Action Registry, Policy Engine y Effect Sink desde el inicio**;
- fake adapters sin red/credenciales;
- lifecycle, CAS, hash-bound approvals;
- tres flujos testigo y pruebas unitarias.

**Gate de salida Fase 1:** engine puro, simulador network-deny, manifest/environment snapshot exhaustivos y contratos de continuation/claims/adapters aprobados; ninguna fila “Entrada a Fase 1” pendiente.

### Fase 2 — Persistencia y worker

- tablas/constraints/immutability guards;
- protocolo inbox→job→run, conversation lock/sequence;
- effect ledger/reconciler, jobs/leases/DLQ;
- state machines, pause/drain/cancel y auditoría;
- benchmark Postgres y fault injection.

**Gate de salida Fase 2:** ninguna fila “Entrada a Fase 2” pendiente; schema/constraints implementan `WAITING_EFFECT`, replay diagnóstico, dispatch scavenging, `CANCELLED_BEFORE_DISPATCH` y guards de cancelación; Dispatch Scope Journal y matrices §16.2/capacidad §14 ejecutados satisfactoriamente.

### Fase 3 — Meta y contenido

- verificación HTTP separada, adapter Meta, versioned content/templates;
- garantía/reconciliación real documentada;
- número de prueba y dependency manifest staging.

**Gate:** contract tests y kill switches. Media sigue apagada hasta su gate.

### Fase 4 — Editor administrativo

- editor estructurado, CAS, blast radius, diff semántico, aprobación dual y simulator UI;
- publicación/pause/drain/rollback sin migración.

**Gate:** seguridad de publicación y RBAC aprobados.

### Fase 5 — Handoff y media opcional

- adapter Chatwoot y saga/authority;
- pipeline media completo con scanner antes de piloto documental.

**Gate:** PII permitida, contract tests, adversarial media y runbooks.

### Fase 6 — Piloto y endurecimiento

- SLO/alerts/on-call, recovery drills, load, retention/purge/restore;
- piloto limitado a patrones v1 y bindings de prueba.

Import/export mediante archivo/PR, canvas y subflows permanecen **DEFERRED** salvo decisión posterior basada en un caso testigo.

---

## 18. Persistencia conceptual

| Tabla | Propósito/constraints clave |
|---|---|
| `automation_flows` | Lifecycle y active version. |
| `automation_flow_drafts` | Un draft/flow, revision/hash CAS. |
| `automation_flow_versions` | Snapshot inmutable, definition hash. |
| `automation_compiled_manifests` | Manifest/hash inmutable. |
| `automation_environment_resolution_snapshots` | Destinos físicos no secretos, generaciones y hash inmutables. |
| `automation_publication_approvals` | Actor y hash; invalidación por cambio. |
| `automation_flow_bindings` | Routing y environment refs. |
| `automation_conversations` | sequence, lockVersion, response authority. |
| `automation_flow_runs` | version/manifest/environment snapshot FK, awaited effect y state machine; unique parcial activo/conversation. |
| `automation_step_activations` | activation ordinal lógico. |
| `automation_step_attempts` | Intentos de cálculo, no identidad de efecto. |
| `automation_inbound_events` | Dedup, sequence y estado inbox. |
| `automation_jobs` | Job state/lease, unique materialization. |
| `automation_replay_requests` | Actor/motivo, source inbox/run, replay ordinal y unique request diagnóstica. |
| `automation_replay_reports` | Resultado side-effect-free, snapshots usados, commands candidatos y diff; nunca autoridad de ejecución. |
| `automation_effect_ledger` | logical effect, payload hash, state/policy. |
| `automation_effect_attempts` | execution attempt, dispatch owner/lease/heartbeat y observations. |
| `automation_effect_continuations` | ID derivado, awaited effect, completion mode, outcome mapping y estado/materialización/consumo únicos. |
| `automation_manual_resolutions` | Resolución autorizada, evidence ref y aprobación sensible. |
| `automation_messages` | Mensaje canónico y refs externas. |
| `automation_media` | quarantine/scan/clean metadata. |
| `automation_handoffs` | Saga, ordinal y external key. |
| `automation_trusted_claims` | Issuer/provenance/expiry/revocation. |
| `automation_audit_log` | Append-only, redactado. |

Los nombres Drizzle finales pueden variar, no sus invariantes. JSONB no reemplaza constraints relacionales para identity, lifecycle, locks, hashes y uniqueness.

`Dispatch Scope Journal` no vive únicamente en estas tablas: su copia autoritativa append-only está fuera del RPO/failure domain de Postgres según §15.1; Postgres puede mantener una réplica consultable, nunca la única fuente.

---

## 19. Administración y permisos

Permisos mínimos:

| Permiso | Alcance |
|---|---|
| `automation.view` | Definiciones/runs redactados. |
| `automation.edit` | Operaciones de intención sobre draft con CAS. |
| `automation.publish` | Publicación no sensible. |
| `automation.publish_sensitive` | Proponer/aprobar publicación sensible; four-eyes obligatorio. |
| `automation.operate` | Pause/drain/retry/cancel conforme policy. |
| `automation.reconcile` | Resolver efectos/handoffs ambiguos; dual para sensibles. |
| `automation.audit` | Diagnóstico/decrypt según data policy. |

El backend no acepta `updateJson` irrestricto. Operaciones de intención exigen expected revision/hash. `retryRun` no existe como repetición indiscriminada: se reintenta un job/effect elegible conforme su state machine. `cancelRun` produce dry-run de efectos/handoff y transición `CANCEL_REQUESTED`.

---

## 20. Registro de decisiones

| ID | Decisión | Estado | Owner | Condición/pendiente |
|---|---|---|---|---|
| ADR-01 | Monolito modular dentro de CRM v1 | **APPROVED** | Platform Architecture | Extraer por umbrales §14 o aislamiento operativo. |
| ADR-02 | Meta como primer Channel Adapter | **APPROVED** | Messaging Platform | Garantía/reconciliación se confirma por contract test. |
| ADR-03 | Chatwoot como Human Inbox Adapter, no autoridad financiera | **APPROVED** | CX Platform | Modalidad y PII siguen ADR-16. |
| ADR-04 | Postgres como queue inicial | **PROPOSED** | Database/Platform Owner | Decidir antes de Fase 2, 2026-08-20, con spike/plan; benchmark final §14 es gate de salida, no prerrequisito circular. |
| ADR-05 | JSONB snapshot + RFC 8785 + migradores/DB guards | **PROPOSED** | Platform Architecture | Validar y decidir antes de Fase 1, 2026-08-13. |
| ADR-06 | Engine puro produce commands; Effect Sink externo | **APPROVED** | Platform Architecture | Obligatorio desde Fase 1. |
| ADR-07 | `logicalEffectId` estable y ledger/reconciliación | **APPROVED** | Platform Architecture + Risk | Cada adapter declara garantía. |
| ADR-08 | `trustedClaims` system-owned y policy runtime | **APPROVED** | Security | Issuer/método concreto antes de action sensible. |
| ADR-09 | Manifest fija todas las dependencias | **APPROVED** | Platform Architecture | Definir ventana operacional de compatibilidad por release. |
| ADR-10 | No migrar runs activos en v1 | **APPROVED** | Platform Architecture | Solo drain/cancel/runbook. |
| ADR-11 | Pause/drain/cancel según matriz §9 | **APPROVED** | Platform Operations | Validación en fault tests. |
| ADR-12 | Toda versión alcanzable sensible usa four-eyes por hash | **APPROVED** | Security/Risk | Nombrar grupos RBAC concretos. |
| ADR-13 | Subflows, fork/join, compensación general e import/export UI | **DEFERRED** | Product + Architecture | Reabrir con caso testigo y semántica formal. |
| ADR-14 | Antimalware antes de piloto documental | **APPROVED** | Security | Sin scanner, media deshabilitada. |
| ADR-15 | TTL/cifrado/backups baseline §13 | **PROPOSED** | Data Protection Owner | Campos de Fase 2 antes de 2026-08-20; resto antes de su adapter/piloto. |
| ADR-16 | Chatwoot cloud/self-hosted y PII permitida | **PROPOSED** | CX + Security | DPA, residencia, borrado y allowlist. |
| ADR-17 | SLO/RPO/RTO provisionales | **PROPOSED** | SRE/Business Continuity | Aprobar antes del piloto. |
| ADR-18 | Fuente concreta de roles/grants automation | **PROPOSED** | Security + CRM Owner | Decidir antes de Fase 2, 2026-08-20; grants runtime son explícitos. |
| ADR-19 | Garantía Meta por command (`at-least/at-most/reconcile`) | **PROPOSED** | Messaging Platform | Verificar API oficial y pruebas de ambigüedad. |
| ADR-20 | Catálogo limitado a patrones §2.3 | **APPROVED** | Product + Architecture | Nuevas primitivas requieren ADR y testigo. |

`APPROVED` fija dirección normativa; no afirma que ya esté implementada. `PROPOSED` bloquea el gate indicado. `DEFERRED` está fuera de v1 y no puede aparecer silenciosamente en implementación.

---

## 21. Preguntas genuinamente abiertas

1. ¿Qué issuer y métodos concretos producen `PHONE_MATCHED`, `VERIFIED` y `STRONG_VERIFIED`, con qué expiración y revocación? Owner: Security.
2. ¿Cuáles son los grupos/personas RBAC para editar, publicar, aprobar sensible, operar y reconciliar? Owner: Security/CRM.
3. ¿Qué garantía ofrece Meta para cada command y qué sesgo se acepta cuando no hay reconciliación: omisión o duplicado? Owner: Messaging/Risk.
4. ¿Qué TTL final y obligación legal aplica a cada copia, incluidos Chatwoot y backups? Owner: Data Protection.
5. ¿Chatwoot será cloud o autohospedado y qué campos puede recibir? Owner: CX/Security.
6. ¿Quién/evento puede solicitar retorno humano y qué identidad de agente es confiable? Owner: CX/Security.
7. ¿Se aprueban baseline de capacidad, SLO, RPO/RTO y on-call? Owners: Platform/SRE/Business Continuity.
8. ¿Qué actions concretas se habilitarán en un piloto posterior? Esto no cambia el alcance infraestructural, pero define sus contracts de idempotencia. Owner: Product/Risk.
9. ¿El editor vive en CRM Admin o en otro módulo? Owner: CRM Product; no cambia seams ni garantías.
10. ¿Se promoverán artefactos por UI, archivo/PR o ambos? Owner: Platform Product; import/export UI sigue deferred.

No queda abierta la migración de runs ni el requisito antimalware: ambas decisiones están aprobadas para v1.

---

## 22. Resultado esperado

Al cumplir los gates, Cashin tendrá una plataforma donde:

- Meta y Chatwoot son adapters reemplazables;
- el runtime propio ejecuta únicamente patrones declarativos soportados;
- una versión publicada conserva definición y dependencias exactas;
- editar/borrar steps no altera historia ni evade dominadores;
- Postgres conserva transacciones locales, locks y ledger, mientras la garantía end-to-end de cada efecto depende del contrato y reconciliación del adapter;
- autorización sensible depende de claims system-owned y policy runtime;
- el simulador es técnicamente incapaz de tocar producción;
- pause/drain/cancel/rollback tienen semántica operativa y pruebas;
- medios no confiables permanecen en cuarentena hasta validación y antimalware;
- SLO, recuperación, kill switches y owners condicionan el piloto;
- los flujos concretos de negocio pueden diseñarse después, siempre dentro del catálogo aprobado o agregando nuevas capacidades mediante código y revisión.

Este spec separa deliberadamente la infraestructura de los bots concretos y sustituye promesas amplias por garantías verificables, mecanismos persistentes y oráculos automatizados.