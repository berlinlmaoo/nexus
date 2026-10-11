import SwiftUI
import UIKit

// The "When / If / Do" builder (web: components/automations/AutomationBuilder.tsx, 12 Oct 2026), as a
// native Form so it reads the same on iPhone, iPad and Mac: the trigger and its settings, optional
// conditions, and an ordered list of actions. Project leads only (the sheet shows the read view to others).

private struct DraftCondition: Identifiable { let id = UUID(); var rule: AutomationCondition }
private struct DraftAction: Identifiable { let id = UUID(); var rule: AutomationRule }

extension AutomationRule {
    fileprivate func cfgString(_ k: String) -> String { cfg(k)?.string ?? "" }
    fileprivate mutating func setCfg(_ k: String, _ v: AutoJSON?) {
        var c = config ?? [:]
        if let v { c[k] = v } else { c.removeValue(forKey: k) }
        config = c.isEmpty ? nil : c
    }
}

struct AutomationBuilder: View {
    let projectId: String
    let automation: Automation?
    let ctx: AutomationContext
    let onSaved: () async -> Void

    @State private var name = ""
    @State private var trigger: AutomationRule?
    @State private var match = "all"
    @State private var conditions: [DraftCondition] = []
    @State private var actions: [DraftAction] = []
    @State private var saving = false
    @State private var error: String?
    @State private var confirmRegen = false
    @State private var seeded = false

    var body: some View {
        Form {
            Section {
                TextField(T("Name this automation"), text: $name)
                    .font(NXFont.text(16, .semibold))
            } footer: {
                Text(T("For every task in this project"))
            }

            Section(T("When")) {
                triggerMenu
                if trigger != nil { triggerConfig }
            }

            Section {
                if conditions.count > 1 {
                    Picker(T("Match"), selection: $match) {
                        Text(T("All conditions")).tag("all")
                        Text(T("Any condition")).tag("any")
                    }
                }
                ForEach($conditions) { $c in
                    ConditionEditor(rule: $c.rule, ctx: ctx)
                }
                .onDelete { conditions.remove(atOffsets: $0) }
                if conditions.count < 10 {
                    Button {
                        conditions.append(DraftCondition(rule: AutomationCondition(field: "status", op: "is", value: "TODO")))
                    } label: { Label(T("Add condition"), systemImage: "line.3.horizontal.decrease") }
                }
            } header: {
                Text(T("If (optional)"))
            } footer: {
                if conditions.isEmpty { Text(T("No conditions: every matching event runs it.")) }
            }

            Section(T("Do")) {
                ForEach(Array(actions.enumerated()), id: \.element.id) { i, item in
                    actionBlock(index: i, id: item.id)
                }
                if actions.count < 10 { actionMenu }
            }

            if let problem {
                Section { Text(problem).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
            }
            if let error {
                Section { Text(error).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { Task { await save() } } label: {
                    if saving { ProgressView() } else { Text(automation == nil ? T("Turn on") : T("Save")).bold() }
                }
                .disabled(problem != nil || saving)
            }
        }
        .onAppear(perform: seed)
        .alert(T("Make a new URL"), isPresented: $confirmRegen) {
            Button(T("Cancel"), role: .cancel) {}
            Button(T("Make a new URL"), role: .destructive) { Task { await regenerate() } }
        } message: { Text(T("New URL made. The old one stops working.")) }
    }

    private func seed() {
        guard !seeded else { return }
        seeded = true
        guard let a = automation else { return }
        name = a.name
        trigger = a.trigger
        match = a.conditions?.match ?? "all"
        conditions = (a.conditions?.rules ?? []).map { DraftCondition(rule: $0) }
        actions = a.allActions.map { DraftAction(rule: $0) }
    }

    /// No task to act on: a webhook, or a schedule without conditions.
    private var noTask: Bool {
        trigger?.type == "WEBHOOK_RECEIVED" || (trigger?.type == "SCHEDULED" && conditions.isEmpty)
    }

    /// Why it cannot be saved yet, as the web says it.
    private var problem: String? {
        if name.trimmingCharacters(in: .whitespaces).isEmpty { return T("Give it a name") }
        guard let trigger else { return T("Pick a trigger") }
        if trigger.type == "FIELD_CHANGED" && (trigger.field ?? "").isEmpty { return T("Pick the field to watch") }
        if trigger.type == "SCHEDULED" && trigger.cfgString("frequency") == "weekly" && (trigger.cfg("days")?.ints ?? []).isEmpty {
            return T("Pick at least one day")
        }
        if actions.isEmpty { return T("Add at least one action") }
        for d in actions {
            let a = d.rule
            let label = AutomationVocab.action(a.type).map { T($0.label) } ?? a.type
            let v = (a.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            switch a.type {
            case "SET_STATUS", "SET_PRIORITY", "MOVE_TO_SECTION", "ADD_TAG", "REMOVE_TAG", "ADD_COMMENT", "CALL_WEBHOOK":
                if v.isEmpty { return String(format: T("Finish the “%@” step"), label) }
            case "ASSIGN_TO", "UNASSIGN":
                if v.isEmpty { return String(format: T("Pick who in “%@”"), label) }
            case "SET_FIELD":
                if (a.field ?? "").isEmpty { return T("Pick the field to set") }
            default: break
            }
        }
        return nil
    }

    // MARK: trigger

    private var triggerMenu: some View {
        Menu {
            ForEach(["Task events", "Time", "Other"], id: \.self) { g in
                Section(T(g)) {
                    ForEach(AutomationVocab.triggers.filter { $0.group == g }) { d in
                        Button { pickTrigger(d.type) } label: { Label(T(d.label), systemImage: d.symbol) }
                    }
                }
            }
        } label: {
            HStack {
                if let d = AutomationVocab.trigger(trigger?.type) {
                    Label(T(d.label), systemImage: d.symbol).foregroundStyle(NX.foreground)
                } else if let t = trigger {
                    Text(t.type == "TASK_COMPLETED" ? T("Task completed") : humanizeEnum(t.type)).foregroundStyle(NX.foreground)
                } else {
                    Label(T("New trigger"), systemImage: "plus").foregroundStyle(NX.violetText)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    private func pickTrigger(_ type: String) {
        switch type {
        case "SCHEDULED": trigger = AutomationRule(type: type, config: ["frequency": .string("daily"), "time": .string("09:00")])
        case "DUE_DATE_APPROACHING": trigger = AutomationRule(type: type, value: "24")
        default: trigger = AutomationRule(type: type)
        }
    }

    private var triggerBinding: Binding<AutomationRule> {
        Binding(get: { trigger ?? AutomationRule(type: "TASK_CREATED") }, set: { trigger = $0 })
    }

    @ViewBuilder private var triggerConfig: some View {
        let t = triggerBinding
        switch t.wrappedValue.type {
        case "STATUS_CHANGED":
            Picker(T("From status"), selection: Binding(get: { t.wrappedValue.cfgString("from") },
                                                        set: { v in t.wrappedValue.setCfg("from", v.isEmpty ? nil : .string(v)) })) {
                Text(T("Any status")).tag("")
                ForEach(AutomationVocab.statuses, id: \.self) { Text(TaskStatusName.label($0)).tag($0) }
            }
            Picker(T("To status"), selection: optionalString(t.value)) {
                Text(T("Any status")).tag("")
                ForEach(AutomationVocab.statuses, id: \.self) { Text(TaskStatusName.label($0)).tag($0) }
            }
        case "ASSIGNEE_CHANGED":
            Picker(T("when this person is added"), selection: optionalString(t.value)) {
                Text(T("Anyone (any change)")).tag("")
                ForEach(ctx.members, id: \.id) { Text($0.name).tag($0.id) }
            }
        case "FIELD_CHANGED":
            Picker(T("Field"), selection: Binding(get: { t.wrappedValue.field ?? "" },
                                                  set: { t.wrappedValue.field = $0.isEmpty ? nil : $0; t.wrappedValue.value = nil })) {
                Text(T("Pick a field…")).tag("")
                ForEach(fieldOptions { $0 != "creator" && $0 != "status" && $0 != "assignee" }, id: \.key) { Text($0.label).tag($0.key) }
            }
            if let f = t.wrappedValue.field, !f.isEmpty {
                LabeledContent(f == "tags" ? T("gets the tag") : T("becomes")) {
                    AutoValueEditor(field: f, value: optionalString(t.value), ctx: ctx, anyLabel: T("anything"))
                }
            }
        case "FORM_SUBMITTED":
            Picker(T("Form"), selection: optionalString(t.value)) {
                Text(T("Any form of this project")).tag("")
                ForEach(ctx.forms, id: \.id) { Text($0.name).tag($0.id) }
            }
        case "DUE_DATE_APPROACHING":
            Stepper(value: Binding(get: { Int(t.wrappedValue.value ?? "24") ?? 24 }, set: { t.wrappedValue.value = String($0) }), in: 1...720) {
                Text("\(t.wrappedValue.value ?? "24") \(T("hours before the due date (once per task)"))")
            }
        case "DUE_DATE_REACHED":
            Text(T("Runs once per task when its due date passes and it is not done or cancelled."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        case "SCHEDULED":
            scheduleConfig(t)
        case "WEBHOOK_RECEIVED":
            if let url = automation?.webhookUrl {
                Text(url).font(.system(size: 12, design: .monospaced)).textSelection(.enabled)
                Button { UIPasteboard.general.string = url } label: { Label(T("Copy"), systemImage: "doc.on.doc") }
                Button(role: .destructive) { confirmRegen = true } label: { Label(T("Make a new URL"), systemImage: "arrow.clockwise") }
                Text(T("POST JSON here. Use {payload.key} in texts; \"title\" names a new task, \"taskId\" picks a task of this project."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else {
                Text(T("Save the automation to get its private URL.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        default:
            EmptyView()
        }
    }

    @ViewBuilder private func scheduleConfig(_ t: Binding<AutomationRule>) -> some View {
        let freq = t.wrappedValue.cfgString("frequency").isEmpty ? "daily" : t.wrappedValue.cfgString("frequency")
        Picker(T("Repeat"), selection: Binding(get: { freq }, set: { v in
            t.wrappedValue.setCfg("frequency", .string(v))
            if v == "weekly" && (t.wrappedValue.cfg("days")?.ints ?? []).isEmpty { t.wrappedValue.setCfg("days", .list([.number(1)])) }
        })) {
            Text(T("Every day")).tag("daily")
            Text(T("Every weekday (Mon–Fri)")).tag("weekdays")
            Text(T("Every week")).tag("weekly")
            Text(T("Every month")).tag("monthly")
        }
        DatePicker(T("at") + " (WIB)", selection: Binding(get: { Self.timeDate(t.wrappedValue.cfgString("time")) },
                                                          set: { t.wrappedValue.setCfg("time", .string(Self.timeString($0))) }),
                   displayedComponents: .hourAndMinute)
            .environment(\.timeZone, ProjDate.cal.timeZone)
        if freq == "weekly" {
            let days = t.wrappedValue.cfg("days")?.ints ?? []
            HStack(spacing: 6) {
                ForEach(AutomationVocab.weekdays, id: \.d) { w in
                    let on = days.contains(w.d)
                    Button {
                        let next = on ? days.filter { $0 != w.d } : (days + [w.d]).sorted()
                        t.wrappedValue.setCfg("days", .list(next.map { .number(Double($0)) }))
                    } label: {
                        Text(T(w.label)).font(NXFont.text(12, .semibold))
                            .foregroundStyle(on ? Color.white : NX.foreground)
                            .frame(maxWidth: .infinity, minHeight: 32)
                            .background(on ? NX.violet : NX.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
        if freq == "monthly" {
            Stepper(value: Binding(get: { Int(t.wrappedValue.cfgString("dayOfMonth")) ?? 1 },
                                   set: { t.wrappedValue.setCfg("dayOfMonth", .number(Double($0))) }), in: 1...28) {
                Text("\(T("on day")) \(Int(t.wrappedValue.cfgString("dayOfMonth")) ?? 1)")
            }
        }
        if let next = automation?.nextRunAt {
            Text(String(format: T("Next run: %@"), AutoTime.stamp(next))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        Text(T("Without conditions it runs once (create a task, notify, webhook). With conditions it runs on every task that matches them."))
            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
    }

    private static func timeDate(_ hhmm: String) -> Date {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        var c = ProjDate.cal.dateComponents([.year, .month, .day], from: Date())
        c.hour = parts.first ?? 9
        c.minute = parts.count > 1 ? parts[1] : 0
        return ProjDate.cal.date(from: c) ?? Date()
    }
    private static func timeString(_ d: Date) -> String {
        let c = ProjDate.cal.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    // MARK: actions

    private var actionMenu: some View {
        Menu {
            ForEach(["Edit the task", "Create", "Tell someone"], id: \.self) { g in
                Section(T(g)) {
                    ForEach(AutomationVocab.actions.filter { $0.group == g }) { d in
                        Button {
                            let rule = d.type == "SEND_NOTIFICATION"
                                ? AutomationRule(type: d.type, config: ["to": .list([.string("@assignees")])])
                                : AutomationRule(type: d.type)
                            actions.append(DraftAction(rule: rule))
                        } label: { Label(T(d.label), systemImage: d.symbol) }
                    }
                }
            }
        } label: {
            Label(T("New action"), systemImage: "plus")
        }
    }

    private func binding(for id: UUID) -> Binding<AutomationRule> {
        Binding(
            get: { actions.first { $0.id == id }?.rule ?? AutomationRule(type: "MARK_COMPLETE") },
            set: { new in if let i = actions.firstIndex(where: { $0.id == id }) { actions[i].rule = new } }
        )
    }

    @ViewBuilder private func actionBlock(index i: Int, id: UUID) -> some View {
        let a = binding(for: id)
        let def = AutomationVocab.action(a.wrappedValue.type)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("\(i + 1)").font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 20, height: 20).background(NX.muted, in: Circle())
                Label(def.map { T($0.label) } ?? humanizeEnum(a.wrappedValue.type), systemImage: def?.symbol ?? "bolt")
                    .font(NXFont.text(14, .semibold))
                Spacer()
                Button { move(id, by: -1) } label: { Image(systemName: "arrow.up") }
                    .buttonStyle(.borderless).disabled(i == 0).accessibilityLabel(T("Move up"))
                Button { move(id, by: 1) } label: { Image(systemName: "arrow.down") }
                    .buttonStyle(.borderless).disabled(i == actions.count - 1).accessibilityLabel(T("Move down"))
                Button(role: .destructive) { actions.removeAll { $0.id == id } } label: { Image(systemName: "trash") }
                    .buttonStyle(.borderless).accessibilityLabel(T("Remove action"))
            }
            ActionEditor(rule: a, ctx: ctx)
            if def?.needsTask == true && noTask {
                Label(T("This trigger has no task, so this step is skipped. Add a condition (schedule) or send a taskId (webhook)."),
                      systemImage: "exclamationmark.triangle")
                    .font(NXFont.text(12)).foregroundStyle(NX.warning)
            }
        }
        .padding(.vertical, 4)
    }

    private func move(_ id: UUID, by delta: Int) {
        guard let i = actions.firstIndex(where: { $0.id == id }) else { return }
        let j = i + delta
        guard actions.indices.contains(j) else { return }
        actions.swapAt(i, j)
    }

    private func fieldOptions(_ include: (String) -> Bool) -> [(key: String, label: String)] {
        AutomationVocab.builtinFields.filter { include($0.key) }.map { (key: $0.key, label: T($0.label)) }
            + ctx.fields.filter { include("cf:\($0.id)") }.map { (key: "cf:\($0.id)", label: $0.name) }
    }

    private func optionalString(_ b: Binding<String?>) -> Binding<String> {
        Binding(get: { b.wrappedValue ?? "" }, set: { b.wrappedValue = $0.isEmpty ? nil : $0 })
    }

    // MARK: save

    private func save() async {
        guard let trigger, problem == nil else { return }
        saving = true; error = nil; defer { saving = false }
        let rules = conditions.map(\.rule).filter { !$0.field.isEmpty }
        var body: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "trigger": trigger.json,
            "actions": actions.map { $0.rule.json },
        ]
        // null clears them on an edit (PATCH treats a sent null as "no conditions").
        let conds: [String: Any] = ["match": match, "rules": rules.map(\.json)]
        body["conditions"] = rules.isEmpty ? (NSNull() as Any) : (conds as Any)
        do {
            try await APIClient.shared.saveAutomation(id: automation?.id, projectId: projectId, body: body)
            await onSaved()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save. Only project leads can edit automations.")
        }
    }

    private func regenerate() async {
        guard let id = automation?.id else { return }
        do { try await APIClient.shared.regenerateAutomationWebhook(id: id); await onSaved() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't make a new URL.") }
    }
}

// MARK: - Pieces

/// The value editor for one field: a menu for status, priority, section, person and choice fields;
/// text (or a number pad) otherwise.
private struct AutoValueEditor: View {
    let field: String
    @Binding var value: String
    let ctx: AutomationContext
    var anyLabel: String? = nil
    var placeholder: String? = nil

    var body: some View {
        let kind = ctx.fieldKind(field)
        switch kind {
        case "status":
            Picker("", selection: $value) {
                if let anyLabel { Text(anyLabel).tag("") } else { Text("—").tag("") }
                ForEach(AutomationVocab.statuses, id: \.self) { Text(TaskStatusName.label($0)).tag($0) }
            }
            .labelsHidden()
        case "priority":
            Picker("", selection: $value) {
                if let anyLabel { Text(anyLabel).tag("") } else { Text("—").tag("") }
                ForEach(AutomationVocab.priorities, id: \.self) { Text(AutomationVocab.priorityLabel($0)).tag($0) }
            }
            .labelsHidden()
        case "section":
            Picker("", selection: $value) {
                if let anyLabel { Text(anyLabel).tag("") } else { Text("—").tag("") }
                ForEach(ctx.sections, id: \.id) { Text($0.name).tag($0.id) }
            }
            .labelsHidden()
        case "person":
            Picker("", selection: $value) {
                if let anyLabel { Text(anyLabel).tag("") } else { Text("—").tag("") }
                ForEach(ctx.members, id: \.id) { Text($0.name).tag($0.id) }
            }
            .labelsHidden()
        default:
            let choices = ctx.fields.first { "cf:\($0.id)" == field }?.choices ?? []
            if kind == "select" && !choices.isEmpty {
                Picker("", selection: $value) {
                    if let anyLabel { Text(anyLabel).tag("") } else { Text("—").tag("") }
                    ForEach(choices, id: \.self) { Text($0).tag($0) }
                }
                .labelsHidden()
            } else {
                TextField(placeholder ?? anyLabel ?? T("Value"), text: $value)
                    .keyboardType(kind == "number" ? .decimalPad : .default)
                    .multilineTextAlignment(.trailing)
            }
        }
    }
}

private struct ConditionEditor: View {
    @Binding var rule: AutomationCondition
    let ctx: AutomationContext

    private var options: [(key: String, label: String)] {
        AutomationVocab.builtinFields.map { (key: $0.key, label: T($0.label)) }
            + ctx.fields.map { (key: "cf:\($0.id)", label: $0.name) }
    }

    var body: some View {
        let kind = ctx.fieldKind(rule.field)
        let ops = AutomationVocab.ops(kind)
        let op = ops.first { $0.op == rule.op } ?? ops[0]
        VStack(alignment: .leading, spacing: 6) {
            Picker(T("Field"), selection: Binding(get: { rule.field }, set: { f in
                rule = AutomationCondition(field: f, op: AutomationVocab.ops(ctx.fieldKind(f))[0].op)
            })) {
                ForEach(options, id: \.key) { Text($0.label).tag($0.key) }
            }
            Picker(T("Operator"), selection: Binding(get: { op.op }, set: { rule.op = $0 })) {
                ForEach(ops, id: \.op) { Text(T($0.label)).tag($0.op) }
            }
            if !op.noValue {
                if op.op == "within_days" {
                    LabeledContent(T("Days")) {
                        TextField("7", text: Binding(get: { rule.value ?? "" }, set: { rule.value = $0 }))
                            .keyboardType(.numberPad).multilineTextAlignment(.trailing)
                    }
                } else if kind == "date" {
                    DatePicker(T("Date"), selection: Binding(
                        get: { ProjDate.fmt("yyyy-MM-dd").date(from: rule.value ?? "") ?? Date() },
                        set: { rule.value = ProjDate.fmt("yyyy-MM-dd").string(from: $0) }),
                               displayedComponents: .date)
                } else {
                    LabeledContent(T("Value")) {
                        AutoValueEditor(field: rule.field, value: Binding(get: { rule.value ?? "" }, set: { rule.value = $0 }), ctx: ctx)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// People for Assign to / Unassign / Send notification / Create task: roles first, then project members.
private struct PeoplePicker: View {
    @Binding var ids: [String]
    let specials: [String]
    let ctx: AutomationContext

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(ids, id: \.self) { id in
                HStack {
                    Text(ctx.personName(id)).font(NXFont.text(14))
                    Spacer()
                    Button { ids.removeAll { $0 == id } } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                        .buttonStyle(.borderless)
                        .accessibilityLabel(String(format: T("Remove %@"), ctx.personName(id)))
                }
            }
            Menu {
                Section(T("Roles")) {
                    ForEach(specials.filter { !ids.contains($0) }, id: \.self) { s in
                        Button(ctx.personName(s)) { ids.append(s) }
                    }
                }
                Section(T("Project members")) {
                    ForEach(ctx.members.filter { !ids.contains($0.id) }, id: \.id) { m in
                        Button(m.name) { ids.append(m.id) }
                    }
                }
            } label: {
                Label(T("Add"), systemImage: "person.badge.plus").font(NXFont.text(14))
            }
        }
    }
}

private struct ActionEditor: View {
    @Binding var rule: AutomationRule
    let ctx: AutomationContext

    private var value: Binding<String> { Binding(get: { rule.value ?? "" }, set: { rule.value = $0.isEmpty ? nil : $0 }) }
    private func cfg(_ k: String) -> Binding<String> {
        Binding(get: { rule.cfgString(k) }, set: { rule.setCfg(k, $0.isEmpty ? nil : .string($0)) })
    }
    private var valueList: Binding<[String]> {
        Binding(get: { (rule.value ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } },
                set: { rule.value = $0.isEmpty ? nil : $0.joined(separator: ",") })
    }
    private func cfgList(_ k: String) -> Binding<[String]> {
        Binding(get: { rule.cfg(k)?.strings ?? [] },
                set: { rule.setCfg(k, $0.isEmpty ? nil : .list($0.map { .string($0) })) })
    }
    private let personSpecials = ["@actor", "@creator"]
    private var hint: some View {
        Text(String(format: T("Placeholders: %@"), AutomationVocab.templateHint)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
    }

    var body: some View {
        switch rule.type {
        case "SET_STATUS":
            Picker(T("Status"), selection: value) {
                Text(T("Pick a status…")).tag("")
                ForEach(AutomationVocab.statuses, id: \.self) { Text(TaskStatusName.label($0)).tag($0) }
            }
        case "SET_PRIORITY":
            Picker(T("Priority"), selection: value) {
                Text(T("Pick a priority…")).tag("")
                ForEach(AutomationVocab.priorities, id: \.self) { Text(AutomationVocab.priorityLabel($0)).tag($0) }
            }
        case "ASSIGN_TO":
            PeoplePicker(ids: valueList, specials: personSpecials, ctx: ctx)
        case "UNASSIGN":
            PeoplePicker(ids: valueList, specials: ["@all"] + personSpecials, ctx: ctx)
        case "MOVE_TO_SECTION":
            Picker(T("Section"), selection: value) {
                Text(T("Pick a section…")).tag("")
                ForEach(ctx.sections, id: \.id) { Text($0.name).tag($0.id) }
            }
        case "ADD_TAG", "REMOVE_TAG":
            TextField(T("Tag"), text: value).textInputAutocapitalization(.never)
        case "SET_FIELD":
            setField
        case "ADD_COMMENT":
            TextField(T("Comment text"), text: value, axis: .vertical).lineLimit(2...6)
            hint
        case "SEND_NOTIFICATION":
            PeoplePicker(ids: Binding(get: { let v = rule.cfg("to")?.strings ?? []; return v.isEmpty ? ["@assignees"] : v },
                                      set: { v in rule.setCfg("to", v.isEmpty ? nil : .list(v.map { .string($0) })) }),
                         specials: ["@assignees", "@actor", "@creator", "@leads"], ctx: ctx)
            TextField(T("Message (empty = the task title)"), text: value, axis: .vertical).lineLimit(2...6)
            hint
        case "CREATE_TASK":
            TextField(T("Task title (supports {task}, {payload.title})"), text: value)
            Picker(T("Section"), selection: cfg("sectionId")) {
                Text(T("First section")).tag("")
                ForEach(ctx.sections, id: \.id) { Text($0.name).tag($0.id) }
            }
            Picker(T("Priority"), selection: cfg("priority")) {
                Text(T("Default priority")).tag("")
                ForEach(AutomationVocab.priorities, id: \.self) { Text(AutomationVocab.priorityLabel($0)).tag($0) }
            }
            TextField(T("Due: +3, today…"), text: cfg("due")).textInputAutocapitalization(.never)
            PeoplePicker(ids: cfgList("assignees"), specials: personSpecials, ctx: ctx)
        case "CREATE_SUBTASK":
            TextField(T("Subtask title"), text: value)
        case "DUPLICATE_TASK":
            Picker(T("Section"), selection: cfg("sectionId")) {
                Text(T("Same section")).tag("")
                ForEach(ctx.sections, id: \.id) { Text($0.name).tag($0.id) }
            }
        case "ARCHIVE_TASK":
            Text(T("The task is deleted and can be restored from Control Room → Audit for 90 days."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        case "CALL_WEBHOOK":
            TextField("https://example.com/hook", text: value)
                .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                .font(.system(size: 13, design: .monospaced))
            Text(T("NEXUS POSTs the task and what changed as JSON. https only; private addresses are refused."))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        default:
            EmptyView()
        }
    }

    @ViewBuilder private var setField: some View {
        let options = AutomationVocab.builtinFields.filter { AutomationVocab.settableBuiltin.contains($0.key) }.map { (key: $0.key, label: T($0.label)) }
            + ctx.fields.filter { !["FILE", "CREATED", "PLACE"].contains($0.type.uppercased()) }.map { (key: "cf:\($0.id)", label: $0.name) }
        Picker(T("Field"), selection: Binding(get: { rule.field ?? "" }, set: { rule.field = $0.isEmpty ? nil : $0; rule.value = nil })) {
            Text(T("Pick a field…")).tag("")
            ForEach(options, id: \.key) { Text($0.label).tag($0.key) }
        }
        if let f = rule.field, !f.isEmpty {
            if f == "dueDate" || f == "startDate" || ctx.fieldKind(f) == "date" {
                TextField(T("+3 = in 3 days, today, 2026-12-31, empty = clear"), text: value).textInputAutocapitalization(.never)
            } else {
                LabeledContent(T("to")) {
                    AutoValueEditor(field: f, value: value, ctx: ctx, placeholder: T("New value (supports {task})"))
                }
            }
        }
    }
}
