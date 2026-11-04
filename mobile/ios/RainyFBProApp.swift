import SwiftUI

@main
struct RainyFBProApp: App {
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                VStack(spacing: 16) {
                    Image(systemName: "bolt.horizontal.circle.fill")
                        .font(.system(size: 48))
                        .foregroundStyle(.blue)
                    Text("RAINY FB Pro")
                        .font(.title2.bold())
                    Text("Safari дээр Facebook нээгээд RAINY FB Pro өргөтгөлийг идэвхжүүлнэ үү.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Link("Facebook нээх", destination: URL(string: "https://www.facebook.com/")!)
                        .buttonStyle(.borderedProminent)
                }
                .padding()
                .navigationTitle("RAINY FB Pro")
            }
        }
    }
}
