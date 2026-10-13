import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The phone number on the profile (Settings › Profile, as the dev web's ProfileSection: one Save sends
// the name and the number together, PATCH /api/user/profile {name, phoneNumber}). AppUser does not carry
// the number, so it is read here from the same GET the web reads. The server normalises an Indonesian
// number (08… → +628…), accepts "+<country code>…" for others, clears it on null or "", and refuses
// anything else with a sentence ("Enter a valid Indonesian phone number…") that is shown as it comes.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {
    /// The signed-in person's phone number, nil when none is set.
    func profilePhoneNumber() async throws -> String? {
        let data = try await settingsExchange(makeRequest("/api/user/profile"))
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let user = obj?["user"] as? [String: Any]
        let phone = user?["phoneNumber"] as? String
        return (phone?.isEmpty ?? true) ? nil : phone
    }

    /// Name and phone number in one PATCH, as the web's Save. An empty number removes it. Returns the
    /// number as the server stored it (normalised), so the field can show that.
    @discardableResult
    func updateProfile(name: String, phoneNumber: String) async throws -> String? {
        var req = makeRequest("/api/user/profile", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let phone = phoneNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        let body: [String: Any] = ["name": name, "phoneNumber": phone.isEmpty ? (NSNull() as Any) : (phone as Any)]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let data = try await settingsExchange(req)
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let user = obj?["user"] as? [String: Any]
        return user?["phoneNumber"] as? String
    }

    /// One round trip: 401 signs out, any other refusal carries the server's own sentence.
    private func settingsExchange(_ req: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req)
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let message = obj?["error"] as? String
            throw APIError.http(http.statusCode, (message?.isEmpty ?? true) ? nil : message)
        }
        return data
    }
}
