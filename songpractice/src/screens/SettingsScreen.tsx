import React, {useMemo, useState} from 'react';
import {Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';

import {activeSearchProvider} from '../agent/search';
import {LlmProvider, SearchProvider} from '../agent/types';
import {useInstrumentSurface} from '../audio/InstrumentProvider';
import {useStore} from '../state/store';
import {colors, radius, space, type} from '../theme';
import {Card, Row, SectionLabel, Segmented} from '../components/ui';

export function SettingsScreen({onBack}: {onBack: () => void}) {
  const {settings, updateSettings, prefs, updatePrefs} = useStore();
  useInstrumentSurface(useMemo(() => ({mode: 'none'}) as const, []), 0);

  const searchInUse = activeSearchProvider(settings);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Row style={styles.header}>
        <Text style={type.title}>Settings</Text>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
          <Text style={styles.backText}>Done</Text>
        </Pressable>
      </Row>

      <Card>
        <SectionLabel>Which model researches the song</SectionLabel>
        <Segmented
          options={[
            {value: 'deepseek', label: 'DeepSeek'},
            {value: 'claude', label: 'Claude'},
          ]}
          value={settings.llmProvider}
          onChange={(v) => updateSettings({llmProvider: v as LlmProvider})}
        />
        <Text style={type.dim}>
          {settings.llmProvider === 'deepseek'
            ? 'DeepSeek has no web search of its own, so the app searches and reads pages on the device and hands the text to the model.'
            : 'Claude runs web search and page fetching on Anthropic servers, so no separate search key is needed.'}
        </Text>
      </Card>

      {settings.llmProvider === 'deepseek' ? (
        <>
          <Card>
            <SectionLabel>DeepSeek</SectionLabel>
            <Secret
              label="API key"
              value={settings.deepseekKey}
              onChange={(v) => updateSettings({deepseekKey: v.trim()})}
              placeholder="sk-…"
            />
            <Field
              label="Model"
              value={settings.deepseekModel}
              onChange={(v) => updateSettings({deepseekModel: v.trim()})}
              placeholder="deepseek-chat"
            />
            <Field
              label="Base URL"
              value={settings.deepseekBaseUrl}
              onChange={(v) => updateSettings({deepseekBaseUrl: v.trim()})}
              placeholder="https://api.deepseek.com"
            />
            <Link url="https://platform.deepseek.com/api_keys" label="Get a DeepSeek key" />
          </Card>

          <Card>
            <SectionLabel right={<Text style={styles.inUse}>using {searchInUse}</Text>}>Web search</SectionLabel>
            <Segmented
              options={[
                {value: 'duckduckgo', label: 'Free'},
                {value: 'tavily', label: 'Tavily'},
                {value: 'brave', label: 'Brave'},
              ]}
              value={settings.searchProvider}
              onChange={(v) => updateSettings({searchProvider: v as SearchProvider})}
            />
            {settings.searchProvider === 'tavily' ? (
              <Secret
                label="Tavily key"
                value={settings.tavilyKey}
                onChange={(v) => updateSettings({tavilyKey: v.trim()})}
                placeholder="tvly-…"
              />
            ) : null}
            {settings.searchProvider === 'brave' ? (
              <Secret
                label="Brave key"
                value={settings.braveKey}
                onChange={(v) => updateSettings({braveKey: v.trim()})}
                placeholder="BSA…"
              />
            ) : null}
            <Text style={type.dim}>
              {settings.searchProvider === 'duckduckgo'
                ? 'The free option scrapes DuckDuckGo. It needs no key but can be rate limited or blocked. A search key makes lookups far more reliable.'
                : 'Falls back to the free DuckDuckGo search if the key is missing.'}
            </Text>
          </Card>
        </>
      ) : (
        <Card>
          <SectionLabel>Anthropic</SectionLabel>
          <Secret
            label="API key"
            value={settings.claudeKey}
            onChange={(v) => updateSettings({claudeKey: v.trim()})}
            placeholder="sk-ant-…"
          />
          <Field
            label="Model"
            value={settings.claudeModel}
            onChange={(v) => updateSettings({claudeModel: v.trim()})}
            placeholder="claude-opus-5"
          />
          <Link url="https://console.anthropic.com/settings/keys" label="Get an Anthropic key" />
        </Card>
      )}

      <Card>
        <SectionLabel>Keyboard</SectionLabel>
        <Text style={type.dim}>Key width: {prefs.keyWidth}px</Text>
        <Segmented
          options={[
            {value: '38', label: 'Narrow'},
            {value: '44', label: 'Comfy'},
            {value: '52', label: 'Wide'},
          ]}
          value={String(prefs.keyWidth)}
          onChange={(v) => updatePrefs({keyWidth: Number(v)})}
        />
        <Text style={type.dim}>
          Wider keys are easier to hit but show less of the keyboard at once; the keybed slides automatically to keep
          the notes you need in view.
        </Text>
      </Card>

      <Card>
        <SectionLabel>Agent</SectionLabel>
        <Text style={type.dim}>Step budget: {settings.maxSteps}</Text>
        <Segmented
          options={[
            {value: '8', label: 'Quick'},
            {value: '12', label: 'Normal'},
            {value: '20', label: 'Thorough'},
          ]}
          value={String(settings.maxSteps)}
          onChange={(v) => updateSettings({maxSteps: Number(v)})}
        />
        <Text style={type.dim}>
          How many searches and page reads the agent may do before giving up. More steps cost more tokens.
        </Text>
      </Card>

      <Text style={styles.note}>
        API keys are kept in the device keystore, never sent anywhere except the provider you chose.
      </Text>
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={type.tiny}>{label.toUpperCase()}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function Secret({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <View style={styles.field}>
      <Row style={styles.fieldHead}>
        <Text style={type.tiny}>{label.toUpperCase()}</Text>
        <Pressable onPress={() => setShown((s) => !s)} hitSlop={8}>
          <Text style={styles.reveal}>{shown ? 'hide' : 'show'}</Text>
        </Pressable>
      </Row>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!shown}
      />
    </View>
  );
}

function Link({url, label}: {url: string; label: string}) {
  return (
    <Pressable onPress={() => Linking.openURL(url).catch(() => {})}>
      <Text style={styles.link}>{label} →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.bg},
  content: {padding: space.lg, gap: space.md, paddingBottom: space.xl},
  header: {justifyContent: 'space-between'},
  back: {paddingVertical: 6, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt},
  backText: {color: colors.text, fontSize: 13, fontWeight: '700'},
  field: {gap: 4},
  fieldHead: {justifyContent: 'space-between'},
  reveal: {color: colors.textDim, fontSize: 11, fontWeight: '700'},
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  link: {color: colors.melody, fontSize: 13, fontWeight: '600'},
  inUse: {...type.tiny, color: colors.accent},
  note: {...type.dim, color: colors.textFaint, textAlign: 'center'},
});
