/**
 * The web-search card renders one provider selector and the settings owned by
 * the selected provider. Credentials are written through the credentials
 * domain and never appear in the settings section.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { PluginCard } from './PluginCard.tsx'
import type { CardFieldState } from './card-form.ts'
import { SelectField, SecretField, ToggleField, ValueField } from './fields.tsx'
import type { WebSearchCardFace, WebSearchCardState } from './web-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the web-search card. */
export type WebSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<WebSearchCardFace>

/** Render one provider-specific value field. */
function ProviderValueField(props: {
  state: WebSearchCardState
  field: string
  id: string
  label: Parameters<WebSearchCardProps['t']>[0]
  hint: Parameters<WebSearchCardProps['t']>[0]
  t: WebSearchCardProps['t']
  numeric?: boolean
  onEdit: (text: string) => void
  onReset: () => void
}) {
  const providerFields = props.state.providerFields as unknown as Record<string, CardFieldState | undefined>
  const value = providerFields[props.field]
  if (value === undefined || typeof value === 'string') return null
  return (
    <ValueField
      id={props.id}
      label={props.t(props.label)}
      hint={props.t(props.hint)}
      overriddenLabel={props.t('overridden')}
      resetLabel={props.t('reset')}
      invalidLabel={props.t('invalidNumber')}
      {...props.numeric === true ? { numeric: true } : {}}
      disabled={!props.state.writable}
      {...value}
      onEdit={props.onEdit}
      onReset={props.onReset}
    />
  )
}

/** Render the web-search provider card. */
export function WebSearchCard(props: WebSearchCardProps) {
  const { t } = props
  const state = props.useWebSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  const fields = state.providerFields
  const providerOptions = state.providerOptions.map(option => ({
    value: option.id,
    label: option.labelKey === undefined ? option.label ?? option.id : t(option.labelKey),
    disabled: !option.available,
  }))
  return (
    <PluginCard
      t={t}
      titleKey="webSearchTitle"
      descriptionKey="webSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SelectField
        id="plugin-config-web-search-provider"
        label={t('webSearchProvider')}
        hint={t('webSearchProviderHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        options={providerOptions}
        {...state.provider}
        onEdit={(text) => { props.edit('searchProvider', text) }}
        onReset={() => { props.resetField('searchProvider') }}
      />
      <SecretField
        id="plugin-config-web-search-key"
        label={t('webSearchApiKey')}
        hint={t('webSearchApiKeyHint')}
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('webSearchApiKeySet') : t('webSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ProviderValueField
        state={state}
        field="baseURL"
        id="plugin-config-web-search-endpoint"
        label="webSearchBaseUrl"
        hint="webSearchBaseUrlHint"
        t={t}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ProviderValueField
        state={state}
        field="model"
        id="plugin-config-web-search-model"
        label="webSearchModel"
        hint="webSearchModelHint"
        t={t}
        onEdit={(text) => { props.edit('model', text) }}
        onReset={() => { props.resetField('model') }}
      />
      {fields.providerId === 'deepseek-official'
        ? (
          <>
            <ProviderValueField
              state={state}
              field="apiVersion"
              id="plugin-config-web-search-api-version"
              label="webSearchApiVersion"
              hint="webSearchApiVersionHint"
              t={t}
              onEdit={(text) => { props.edit('apiVersion', text) }}
              onReset={() => { props.resetField('apiVersion') }}
            />
            <ProviderValueField
              state={state}
              field="maxTokens"
              id="plugin-config-web-search-max-tokens"
              label="webSearchMaxTokens"
              hint="webSearchMaxTokensHint"
              t={t}
              numeric
              onEdit={(text) => { props.edit('maxTokens', text) }}
              onReset={() => { props.resetField('maxTokens') }}
            />
            <ProviderValueField
              state={state}
              field="maxUses"
              id="plugin-config-web-search-max-uses"
              label="webSearchMaxUses"
              hint="webSearchMaxUsesHint"
              t={t}
              numeric
              onEdit={(text) => { props.edit('maxUses', text) }}
              onReset={() => { props.resetField('maxUses') }}
            />
          </>
        )
        : (
          <>
            <ProviderValueField
              state={state}
              field="maxOutputTokens"
              id="plugin-config-web-search-max-output-tokens"
              label="webSearchMaxOutputTokens"
              hint="webSearchMaxOutputTokensHint"
              t={t}
              numeric
              onEdit={(text) => { props.edit('maxOutputTokens', text) }}
              onReset={() => { props.resetField('maxOutputTokens') }}
            />
            <ProviderValueField
              state={state}
              field="allowedDomains"
              id="plugin-config-web-search-allowed-domains"
              label="webSearchAllowedDomains"
              hint="webSearchAllowedDomainsHint"
              t={t}
              onEdit={(text) => { props.edit('allowedDomains', text) }}
              onReset={() => { props.resetField('allowedDomains') }}
            />
            <ProviderValueField
              state={state}
              field="blockedDomains"
              id="plugin-config-web-search-blocked-domains"
              label="webSearchBlockedDomains"
              hint="webSearchBlockedDomainsHint"
              t={t}
              onEdit={(text) => { props.edit('blockedDomains', text) }}
              onReset={() => { props.resetField('blockedDomains') }}
            />
            <ToggleField
              id="plugin-config-web-search-external-access"
              label={t('webSearchExternalWebAccess')}
              hint={t('webSearchExternalWebAccessHint')}
              overriddenLabel={t('overridden')}
              resetLabel={t('reset')}
              invalidLabel={t('invalidNumber')}
              disabled={disabled}
              {...fields.externalWebAccess}
              enabledLabel={t('webSearchEnabled')}
              disabledLabel={t('webSearchDisabled')}
              onToggle={(value) => { props.edit('externalWebAccess', String(value)) }}
              onReset={() => { props.resetField('externalWebAccess') }}
            />
          </>
        )}
    </PluginCard>
  )
}
