# SwiftUI View Lifecycle and App Structure

A Swift UI app is built using declarative views that compose the user interface. The core structure starts with a `@main` entry point using the `App` protocol:

```swift
import SwiftUI

@main
struct MyApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
```

`View` is the fundamental protocol. Each view has a `body: some View` property. Common view types include `Text`, `Image`, `VStack`, `HStack`, `ZStack`, `Form`, `List`, and custom views.

## View Lifecycle

1. **Initialization** - `init()` is called when the view is created.
2. **Body rendering** - SwiftUI evaluates `body` and recomputes when state changes.
3. **Update** - views are updated when state or parent state changes.
4. **Disappearance** - `onAppear` and `onDisappear` are called.

Use `@State` for local mutable state, `@Binding` for passing state to child views, `@ObservedObject` for external observable objects, and `@Environment` for system values like color scheme or locale.
