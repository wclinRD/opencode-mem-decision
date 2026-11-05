# Swift UI Modifiers and Common Patterns

SwiftUI UI components are customized with modifiers. Modifiers return a new view, and chaining order can change layout.

## Layout Modifiers
- `.padding()`, `.frame(width:height:alignment:)`, `.position(x:y:)`, `.offset(x:y:)`
- `.background()`, `.foregroundStyle()`, `.mask()`

## Gestures and Interaction
- `.onTapGesture(count:perform:)`
- `.onLongPressGesture(minimumDuration:maximumDistance:perform:)`
- `.onDrag(onBegin:)` and `.onDrop`.

## List and Form
- `.listStyle(.plain)` or `.listStyle(.inset)`.
- `.formStyle(.grouped)`.
- `.navigationBarItems(leading:trailing:)`.

## Text Formatting
- `.bold()`, `.italic()`, `.strikethrough()`, `.underline()`, `.font(.system(size:weight:design:))`.

## Animation
- `.animation(.easeInOut, value:)`, `.transition(.slide)`, `.rotationEffect(angle:)`.

When designing complex views, prefer custom view composability and extract subviews into dedicated `struct`s implementing `View`. Keep modifiers near the view that owns the state they affect.
