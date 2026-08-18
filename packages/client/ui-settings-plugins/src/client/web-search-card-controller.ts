/**
 * The web-search card coordinates the shared provider selector with the
 * settings namespace owned by each registered provider. Provider credentials
 * remain write-only and are addressed through the active provider's reference.
 */

import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  CardForm,
  booleanField,
  listField,
  numberField,
  textField,
  type CardActions,
  type CardFieldState,
  type CardShell,
} from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'

/** Settings namespace owned by the web capability service. */
export const WEB_SETTINGS_NS = 'web'

/** Namespace of the DeepSeek search provider. */
export const WEB_SEARCH_DEEPSEEK_NS = 'web-search-deepseek'

/** Namespace of the OpenAI Responses search provider. */
export const WEB_SEARCH_OPENAI_NS = 'web-search-openai'

/** Provider ids and settings namespaces exposed by this card. */
export const WEB_SEARCH_PROVIDER_DEFINITIONS = [
  {
    id: 'deepseek-official',
    namespace: WEB_SEARCH_DEEPSEEK_NS,
    defaultApiKeyRef: 'DEEPSEEK_API_KEY',
    labelKey: 'webSearchProviderDeepSeek',
    kind: 'deepseek',
  },
  {
    id: 'openai-responses',
    namespace: WEB_SEARCH_OPENAI_NS,
    defaultApiKeyRef: 'OPENAI_API_KEY',
    labelKey: 'webSearchProviderOpenAI',
    kind: 'openai',
  },
] as const

/** Provider id accepted by the shared web service. */
export type WebSearchProviderId = typeof WEB_SEARCH_PROVIDER_DEFINITIONS[number]['id']

/** Settings exposed by a search provider namespace. */
export interface WebSearchSettings {
  /** Credential reference resolved for each search. */
  apiKeyEnv?: string
  /** Provider endpoint base. */
  baseURL?: string
  /** Auxiliary model name. */
  model?: string
  /** DeepSeek Messages API version. */
  apiVersion?: string
  /** DeepSeek generated-token limit. */
  maxTokens?: number
  /** DeepSeek server-tool search limit. */
  maxUses?: number
  /** OpenAI Responses generated-token limit. */
  maxOutputTokens?: number
  /** OpenAI web-search domain allowlist. */
  allowedDomains?: string[]
  /** OpenAI web-search domain blocklist. */
  blockedDomains?: string[]
  /** OpenAI live external web access switch. */
  externalWebAccess?: boolean
}

/** Settings owned by the web service's provider selector. */
export interface WebSelectionSettings {
  /** Explicit registered search provider id. */
  searchProvider?: string
}

/** One option rendered by the provider selector. */
export interface WebSearchProviderOption {
  /** Provider id stored in the `web` namespace. */
  id: string
  /** Locale key for a known provider. */
  labelKey?: PluginsSettingsLocaleKey
  /** Fallback label for a provider not in the local catalog. */
  label?: string
  /** False when the provider is configured but its settings namespace is absent. */
  available: boolean
}

/** DeepSeek-specific controls rendered by the card. */
export interface DeepSeekProviderFields {
  /** Discriminant. */
  providerId: 'deepseek-official'
  /** Endpoint. */
  baseURL: CardFieldState
  /** Model. */
  model: CardFieldState
  /** Anthropic API version. */
  apiVersion: CardFieldState
  /** Generated-token limit. */
  maxTokens: CardFieldState
  /** Search-tool use limit. */
  maxUses: CardFieldState
}

/** OpenAI Responses-specific controls rendered by the card. */
export interface OpenAiProviderFields {
  /** Discriminant. */
  providerId: 'openai-responses'
  /** Endpoint. */
  baseURL: CardFieldState
  /** Model. */
  model: CardFieldState
  /** Generated-token limit. */
  maxOutputTokens: CardFieldState
  /** Domain allowlist. */
  allowedDomains: CardFieldState
  /** Domain blocklist. */
  blockedDomains: CardFieldState
  /** Live external access switch. */
  externalWebAccess: CardFieldState
}

/** The provider-specific fields shown for the active provider. */
export type WebSearchProviderFields = DeepSeekProviderFields | OpenAiProviderFields

/** State rendered by the web-search card. */
export interface WebSearchCardState extends CardShell {
  /** Registered provider selection. */
  provider: CardFieldState
  /** Provider choices currently known to the card. */
  providerOptions: readonly WebSearchProviderOption[]
  /** Provider whose fields are currently rendered. */
  providerId: WebSearchProviderId
  /** Provider-specific settings. */
  providerFields: WebSearchProviderFields
  /** Staged credential for the active provider. */
  apiKey: CardFieldState
  /** Whether the Host reports a credential for the active provider. */
  apiKeyConfigured: boolean
  /** Whether the credentials domain accepts a write for it. */
  apiKeyWritable: boolean
}

/** The registration-side face the web-search card injects into its slot. */
export interface WebSearchCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
}

type ProviderDefinition = typeof WEB_SEARCH_PROVIDER_DEFINITIONS[number]
type ProviderScope = SettingsScope<WebSearchSettings>

/** Bridges provider selection, provider settings, and credentials onto the card. */
export class WebSearchCardController {
  private readonly selectionForm: CardForm<WebSelectionSettings>
  private readonly providerForms = new Map<WebSearchProviderId, CardForm<WebSearchSettings>>()
  private readonly store: SnapshotStore<WebSearchCardState>
  private credential: CredentialState = { providerId: '', ref: '', configured: false, writable: true }
  private saving = false
  private failed = false

  /**
   * @param selectionScope - the `web` namespace that stores provider selection.
   * @param providerScopes - settings scopes keyed by registered provider id.
   * @param api - wire face used for active-provider credentials.
   */
  constructor(
    selectionScope: SettingsScope<WebSelectionSettings>,
    providerScopes: ReadonlyMap<WebSearchProviderId, ProviderScope>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
    this.selectionForm = new CardForm(selectionScope, [textField('searchProvider')])
    for (const definition of WEB_SEARCH_PROVIDER_DEFINITIONS) {
      const scope = providerScopes.get(definition.id)
      if (scope === undefined) continue
      const specs = definition.kind === 'deepseek'
        ? [textField('baseURL'), textField('model'), textField('apiVersion'), numberField('maxTokens'), numberField('maxUses')]
        : [textField('baseURL'), textField('model'), numberField('maxOutputTokens'), listField('allowedDomains'), listField('blockedDomains'), booleanField('externalWebAccess')]
      this.providerForms.set(definition.id, new CardForm(scope, specs, [
        { field: 'apiKey', write: value => this.writeKey(definition.id, value) },
      ]))
    }

    const notify = () => { this.publish() }
    this.selectionForm.subscribe(notify)
    for (const form of this.providerForms.values()) form.subscribe(notify)
    selectionScope.subscribe(() => {
      void this.readCredential()
      this.publish()
    })
    for (const [providerId, scope] of providerScopes) {
      scope.subscribe(() => {
        if (this.activeProviderId() === providerId) void this.readCredential()
        this.publish()
      })
    }
    this.store = createSnapshotStore(this.projection())
    void this.readCredential()
  }

  /** Return the card's current state and actions. */
  inject(): WebSearchCardFace {
    return {
      hooks: { webSearchCard: this.store },
      edit: (field, text) => { this.edit(field, text) },
      resetField: (field) => { this.resetField(field) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
    }
  }

  /** Re-read after the Host reports a credential change for the active provider. */
  refreshCredential(ref: string): void {
    if (ref !== this.credential.ref) return
    void this.readCredential()
  }

  private projection(): WebSearchCardState {
    const definition = this.activeDefinition()
    const form = definition === undefined ? undefined : this.providerForms.get(definition.id)
    const provider = this.selectionField()
    const providerFields = definition === undefined || form === undefined
      ? emptyProviderFields(provider.text)
      : fieldsOf(definition, form)
    const shell = this.shell()
    return {
      ...shell,
      provider,
      providerOptions: this.providerOptions(),
      providerId: providerIdOf(providerFields),
      providerFields,
      apiKey: form?.field('apiKey') ?? emptyField(),
      apiKeyConfigured: definition !== undefined
        && this.credential.providerId === definition.id
        && this.credential.configured,
      apiKeyWritable: this.credential.providerId === (definition?.id ?? '')
        ? this.credential.writable
        : true,
    }
  }

  private shell(): CardShell {
    const selection = this.selectionForm.shell()
    const forms = [...this.providerForms.values()]
    const active = this.activeDefinition()
    const activeShell = active === undefined ? undefined : this.providerForms.get(active.id)?.shell()
    return {
      available: selection.available && forms.some(form => form.shell().available),
      writable: selection.writable && (activeShell?.writable ?? false),
      dirty: selection.dirty || forms.some(form => form.shell().dirty),
      invalid: selection.invalid || forms.some(form => form.shell().invalid),
      saving: this.saving || selection.saving || forms.some(form => form.shell().saving),
      failed: this.failed || selection.failed || forms.some(form => form.shell().failed),
    }
  }

  private selectionField(): CardFieldState {
    const field = this.selectionForm.field('searchProvider')
    if (field.text.length > 0) return field
    const fallback = this.providerOptions().find(option => option.available)
    return fallback === undefined ? field : { ...field, text: fallback.id }
  }

  private providerOptions(): WebSearchProviderOption[] {
    const configured = this.selectionForm.field('searchProvider').text.trim()
    const options: WebSearchProviderOption[] = WEB_SEARCH_PROVIDER_DEFINITIONS.map(definition => ({
      id: definition.id,
      labelKey: definition.labelKey,
      available: this.providerForms.get(definition.id)?.shell().available ?? false,
    }))
    if (configured.length > 0 && !options.some(option => option.id === configured)) {
      options.push({ id: configured, label: configured, available: false })
    }
    return options
  }

  private activeDefinition(): ProviderDefinition | undefined {
    const configured = this.selectionForm.field('searchProvider').text.trim()
    const selected = definitionOf(configured)
    if (selected !== undefined && this.providerForms.get(selected.id)?.shell().available === true) return selected
    return WEB_SEARCH_PROVIDER_DEFINITIONS.find(definition => this.providerForms.get(definition.id)?.shell().available === true)
  }

  private activeProviderId(): WebSearchProviderId | undefined {
    return this.activeDefinition()?.id
  }

  private edit(field: string, text: string): void {
    if (field === 'searchProvider') {
      this.selectionForm.actions().edit(field, text)
    } else {
      this.activeForm()?.actions().edit(field, text)
    }
  }

  private resetField(field: string): void {
    if (field === 'searchProvider') {
      this.selectionForm.actions().resetField(field)
    } else {
      this.activeForm()?.actions().resetField(field)
    }
  }

  private activeForm(): CardForm<WebSearchSettings> | undefined {
    const definition = this.activeDefinition()
    return definition === undefined ? undefined : this.providerForms.get(definition.id)
  }

  private async save(): Promise<void> {
    const forms = [this.selectionForm, ...this.providerForms.values()]
    if (this.saving || !forms.some(form => form.shell().dirty) || forms.some(form => form.shell().invalid)) return
    this.saving = true
    this.failed = false
    this.publish()
    for (const form of forms) await form.save()
    this.saving = false
    this.failed = forms.some(form => form.shell().failed)
    this.publish()
  }

  private discard(): void {
    for (const form of [this.selectionForm, ...this.providerForms.values()]) form.actions().discard()
    this.failed = false
    this.publish()
  }

  private async readCredential(): Promise<void> {
    const definition = this.activeDefinition()
    if (definition === undefined) return
    const form = this.providerForms.get(definition.id)
    if (form === undefined) return
    const snapshot = formSnapshot(form)
    const ref = refOf(snapshot, definition.defaultApiKeyRef)
    if (definition.id !== this.credential.providerId || ref !== this.credential.ref) {
      this.credential = { providerId: definition.id, ref, configured: false, writable: true }
      this.publish()
    }
    let response: Awaited<ReturnType<IApiClient['credentials']['describe']>>
    try {
      response = await this.api.credentials.describe({ refs: [ref] })
    } catch (_credentialReadFailure) {
      return
    }
    const current = this.activeDefinition()
    if (!response.result.ok || current?.id !== definition.id || ref !== refOf(formSnapshot(form), definition.defaultApiKeyRef)) return
    const view = response.result.value.credentials[ref]
    this.credential = {
      providerId: definition.id,
      ref,
      configured: view?.configured ?? false,
      writable: view?.writable ?? true,
    }
    this.publish()
  }

  private async writeKey(providerId: WebSearchProviderId, value: string): Promise<boolean> {
    const definition = definitionOf(providerId)
    const form = this.providerForms.get(providerId)
    if (definition === undefined || form === undefined) return false
    const ref = refOf(formSnapshot(form), definition.defaultApiKeyRef)
    try {
      await this.api.credentials.set({ ref, value })
    } catch (_credentialWriteFailure) {
      // The re-read below is the Host authority on whether the credential landed.
    }
    await this.readCredential()
    return this.credential.providerId === providerId && this.credential.ref === ref && this.credential.configured
  }

  private publish(): void {
    this.store.set(this.projection())
  }
}

/** What the credentials domain last reported, and for which provider reference. */
interface CredentialState {
  providerId: string
  ref: string
  configured: boolean
  writable: boolean
}

function definitionOf(id: string): ProviderDefinition | undefined {
  return WEB_SEARCH_PROVIDER_DEFINITIONS.find(definition => definition.id === id)
}

function providerIdOf(fields: WebSearchProviderFields): WebSearchProviderId {
  return fields.providerId
}

function fieldsOf(definition: ProviderDefinition, form: CardForm<WebSearchSettings>): WebSearchProviderFields {
  if (definition.kind === 'deepseek') {
    return {
      providerId: 'deepseek-official',
      baseURL: form.field('baseURL'),
      model: form.field('model'),
      apiVersion: form.field('apiVersion'),
      maxTokens: form.field('maxTokens'),
      maxUses: form.field('maxUses'),
    }
  }
  return {
    providerId: 'openai-responses',
    baseURL: form.field('baseURL'),
    model: form.field('model'),
    maxOutputTokens: form.field('maxOutputTokens'),
    allowedDomains: form.field('allowedDomains'),
    blockedDomains: form.field('blockedDomains'),
    externalWebAccess: form.field('externalWebAccess'),
  }
}

function emptyProviderFields(id: string): WebSearchProviderFields {
  const empty = emptyField()
  if (id === 'openai-responses') {
    return {
      providerId: 'openai-responses',
      baseURL: empty,
      model: empty,
      maxOutputTokens: empty,
      allowedDomains: empty,
      blockedDomains: empty,
      externalWebAccess: empty,
    }
  }
  return {
    providerId: 'deepseek-official',
    baseURL: empty,
    model: empty,
    apiVersion: empty,
    maxTokens: empty,
    maxUses: empty,
  }
}

function emptyField(): CardFieldState {
  return { text: '', overridden: false, invalid: false }
}

function formSnapshot(form: CardForm<WebSearchSettings>): SettingsScopeSnapshot<WebSearchSettings> {
  return form.snapshot()
}

function refOf(snapshot: SettingsScopeSnapshot<WebSearchSettings>, fallback: string): string {
  const declared = snapshot.value?.apiKeyEnv
  return typeof declared === 'string' && declared.length > 0 ? declared : fallback
}
