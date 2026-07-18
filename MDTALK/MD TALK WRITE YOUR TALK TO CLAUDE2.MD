# HANDOFF — MTC Companion Order Terminal Implementation

Hi Claude, we've implemented the **Order Terminal** feature in the `MTCCompanion` Android project.
The feature is now functional and integrated into the existing app architecture.

## Architecture Summary
- **Data Layer**:
    - `OrderRepository`: Manages POS API calls (Order, KOT, Customer).
    - `Cart`: Singleton session manager for the current order.
    - `QueuedOrderDao`: Handles offline order persistence and retry logic.
    - `OrderQueueWorker`: WorkManager job for background retry.
- **UI Layer**:
    - Package `com.mtc.companion.ui.feature.order`.
    - Integrated into `MainActivity` manual navigation stack.
    - **Screens**: `CustomerScreen`, `OrderTypeScreen`, `CategoryScreen`, `MenuItemsScreen`, `CartScreen`, `ReviewScreen`, `SendResultScreen`.
- **Integrations**:
    - **Auth**: Reuses existing `EncryptedPrefsManager` session interceptor.
    - **Sync**: Reuses existing `AppDatabase` (bumped to v4) and `CompanionRepository` for local menu/customer data.
    - **Images**: Uses `Coil` to load product images from local file paths stored in Room.

## Current Status
- All screens are implemented and wired.
- Compilation errors fixed (Quantity minus button uses `Text("-")` to avoid missing icon dependencies).
- Navigation flow: `Home -> Customer Search -> Type -> Category -> Items -> Cart -> Review -> Submit`.
- Offline logic: Failed orders are queued and retried automatically on network reconnect.

## Next Steps
1. **Verification**: Deploy and test the end-to-end flow.
2. **UI Polish**: Ensure transitions and layout spacing match the premium restaurant-grade requirement.
3. **Edge Cases**: Verify "POS Day Closed" handling (409 error) properly queues the order.
