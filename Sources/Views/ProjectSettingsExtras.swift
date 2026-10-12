import SwiftUI

/// Create a project custom-field definition (name + type + options). Port of the web
/// ProjectCustomFieldsManager add-form.
struct CustomFieldEditor: View {
    let projectId: String
    var onSaved: () async -> Void = {}
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var type = "SELECT"
    @State private var options: [String] = []
    @State private var newOption = ""
    @State private var numberCurrency = false
    @State private var busy = false

    private let types: [(String, String)] = [
        ("SELECT", "Dropdown"), ("MULTI_SELECT", "Multi-select"), ("STATUS", "Status"),
        ("NUMBER", "Angka"), ("DATE", T("Date")), ("PLACE", "Tempat / Map")
    ]
    private var isSelectType: Bool { ["SELECT", "MULTI_SELECT", "STATUS"].contains(type) }
    private var canSave: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && (!isSelectType || !options.isEmpty) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                box(T("Field name")) {
                    TextField("mis. Prioritas Klien", text: $name).font(NXFont.text(15))
                        .padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                box("Tipe") {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                        ForEach(types, id: \.0) { t in
                            Button { type = t.0 } label: {
                                Text(t.1).font(NXFont.text(12, .bold))
                                    .frame(maxWidth: .infinity).padding(.vertical, 9)
                                    .foregroundStyle(type == t.0 ? .white : NX.foreground)
                                    .background(type == t.0 ? NX.violet : NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if isSelectType { optionsBox }
                if type == "NUMBER" {
                    box("Format") {
                        Toggle(isOn: $numberCurrency) {
                            Text("Tampilkan sebagai Rupiah (Rp)").font(NXFont.text(13)).foregroundStyle(NX.foreground)
                        }.tint(NX.violetText)
                    }
                }
                Button { Task { await save() } } label: {
                    Text(busy ? "Menyimpan…" : T("Create field")).font(NXFont.text(15, .bold))
                }.buttonStyle(NexusPrimaryButton()).disabled(!canSave || busy)
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle("Field baru").navigationBarTitleDisplayMode(.inline)
    }

    private var optionsBox: some View {
        box("Pilihan") {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(options.enumerated()), id: \.offset) { idx, opt in
                    HStack {
                        Text(opt).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                        Spacer()
                        Button { options.remove(at: idx) } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                    }
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                HStack {
                    TextField(T("Add an option…"), text: $newOption).font(NXFont.text(13))
                        .onSubmit(addOption)
                    Button(action: addOption) { Image(systemName: "plus.circle.fill").foregroundStyle(NX.violetText) }
                        .disabled(newOption.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }
        }
    }

    private func box<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(label)
            content()
        }
    }
    private func addOption() {
        let v = newOption.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        options.append(v); newOption = ""
    }
    private func save() async {
        busy = true
        var opts: [String: Any]? = nil
        if isSelectType { opts = ["options": options] }
        else if type == "NUMBER", numberCurrency { opts = ["format": "currency-idr"] }
        if (try? await APIClient.shared.createCustomFieldDef(projectId: projectId, name: name.trimmingCharacters(in: .whitespaces), type: type, options: opts)) != nil {
            await onSaved(); dismiss()
        } else { busy = false }
    }
}

/// Invite a teammate to the project by email (creates an invite token server-side).
struct InviteByEmailView: View {
    let projectId: String
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    /// The invitee's access (Notion's invite dropdown, owner 13 Oct 2026); default Can edit, as on the web.
    @State private var level: ProjectAccessLevel = .edit
    @State private var busy = false
    @State private var done: String?
    @State private var failed: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel("EMAIL")
                    TextField(T("name@company.com"), text: $email).font(NXFont.text(15))
                        .keyboardType(.emailAddress).autocorrectionDisabled().textInputAutocapitalization(.never)
                        .padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 6) {
                    SectionLabel(T("Access for the person you invite"))
                    HStack {
                        Text(level.hint).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Spacer(minLength: 6)
                        AccessLevelMenu(value: level, disabled: busy, onChange: { level = $0 })
                    }
                }
                if let done {
                    Text(done).font(NXFont.text(12, .semibold)).foregroundStyle(NX.success)
                }
                if let failed {
                    Text(failed).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                Button { Task { await invite() } } label: {
                    Text(busy ? "Mengirim…" : T("Send invite")).font(NXFont.text(15, .bold))
                }.buttonStyle(NexusPrimaryButton()).disabled(busy || !email.contains("@"))
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Invite member")).navigationBarTitleDisplayMode(.inline)
    }

    private func invite() async {
        busy = true
        done = nil; failed = nil
        let address = email.trimmingCharacters(in: .whitespaces)
        do {
            _ = try await APIClient.shared.inviteProjectMember(projectId: projectId, email: address, level: level)
            done = String(format: T("Invite sent to %@"), address)
            email = ""
        } catch {
            // The address stays in the field; say why it didn't go.
            failed = T("Invite failed. Check the email and your access.")
        }
        busy = false
    }
}
