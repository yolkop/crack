interface Mappings {
    // Vue 2 component options, keyed by their original (kebab-case) component name.
    // *Props are the property names found in that component's `data`/`computed`/`methods`/
    // `watch` blocks in Vue 2 - since Vue 3 doesn't minify object keys, we can match
    // these against the equivalent blocks in the minified Vue 3 component objects to recover
    // the name.
    // *Params are, for a given method/computed getter/watcher name, its original
    // (plain-identifier) parameter names - useful for renaming a minified function's params
    // once we already know which vue2 component/method it corresponds to and the arities match.
    components: {
        name: string;
        dataProps?: string[];
        computedProps?: string[];
        methodProps?: string[];
        watchProps?: string[];
        computedParams?: Record<string, string[]>;
        methodParams?: Record<string, string[]>;
        watchParams?: Record<string, string[]>;
    }[];
    // fallback identification for components too generic to key-match reliably (few/no
    // distinctive data/computed/methods/watch keys) - if the component's render function's
    // generated source contains this literal substring (usually a hardcoded asset path or a
    // chunk of loc text baked into the template), that's enough to call it a match.
    manualComponents: {
        name: string;
        renderContains: string;
    }[];
    variableRemaps: {
        name: string;
        regex: RegExp;
        objectParameters?: Record<string, string[]>;
        // the pointed-at var/function's OWN leading params, renamed positionally - for when the
        // remap target is a plain function rather than (or in addition to) an object literal,
        // e.g. `getRealParent(e)` -> `getRealParent(instance)`.
        params?: string[];
    }[];
    // the `window.xMethods = st;`/`window.xComputed = ut;`-style helper objects (see
    // variableRemaps/the `window.*` pass) - unlike a component, these ARE a flat
    // methods/computed dict themselves (no `methods: {...}` wrapper to look inside), keyed by
    // whatever name the `window.*` pass already gave the var.
    windowGroups: {
        name: string;
        methodParams?: Record<string, string[]>;
        computedParams?: Record<string, string[]>;
    }[];
    // plain top-level functions that aren't Vue components at all - no vue2 data/computed/
    // methods/watch keys to key-match against - but are still worth naming params on. `name` is
    // whatever readable name an earlier pass (usually the `window.*` pass, since these are
    // rarely matched any other way) already resolved the function to. `params` renames the
    // function's own leading params directly; `methodParams`/`computedParams`/`watchParams`
    // reach into the ObjectExpression the function *returns* (e.g. `buildVueOptions`'s root app
    // options object) the same way a component's would.
    topLevelFunctions: {
        name: string;
        params?: string[];
        computedParams?: Record<string, string[]>;
        methodParams?: Record<string, string[]>;
        watchParams?: Record<string, string[]>;
    }[];
    // getter/setter accessor methods anywhere in the file (`get showingItems() {...}` / `set
    // showingItems(e) {...}`), keyed by `"get <name>"`/`"set <name>"` so a getter and setter
    // sharing a property name don't collide - a getter never has params to rename anyway, but
    // keeping both prefixed keeps the convention consistent and self-documenting either way.
    // These usually live deep inside a plain data object (e.g. `vueData.equip`), nowhere near
    // any component/topLevelFunction section, so they get their own flat, global pass instead.
    accessorParams: Record<string, string[]>;
    whitelistedPropKeys: string[];
    // vue2 components confirmed absent from a given build (removed/merged since) - excluded
    // from the "unmatched mapping" log so it doesn't cry wolf about something that was never
    // going to be found.
    knownAbsent: string[];
}

const mappings: Mappings = {
    components: [
        { name: "account-header", computedProps: ["hasEventPanel"] },
        { name: "account-panel", dataProps: ["languageCode", "eggBalance"], computedProps: ["normalizedIsTwitch", "normalizedCurrentScreen", "vueData", "showSignIn", "showShareLinkButton", "vipButtonText", "showVipButton", "isVipLive", "accountBtnCls", "cgUserBtnText", "isCrazyGamesLinked", "cgProfilePictureUrl", "accountBtnText", "isNotSignedIn", "showNotInGame", "signInButtonVisibility", "isGameOwner", "isCrazyGames"], methodProps: ["createBaseState", "initializeEggBalance", "handleEggStoreClick", "handleSettingsClick", "handleTutorialClick", "handleFullscreenClick", "handleShareLinkClick", "handleAccountBtnClick", "handleGameOptionsClick", "handleCrazyGamesLinkClick", "onSignInClicked", "onSubscriptionClick", "eggShake", "onSharedPopupOpen", "gaSend"], watchProps: ["eggs"], methodParams: { "createBaseState": ["text"], "gaSend": ["action", "category"] }, watchParams: { "eggs": ["val"] } },
        { name: "account-status-button", computedProps: ["buttonClasses"] },
        { name: "challenge", methodProps: ["chlgName", "chlgDesc", "chlgImg"], methodParams: { "chlgName": ["ref"], "chlgDesc": ["ref"], "chlgImg": ["ref"] } },
        { name: "chicken-nugget-popup", dataProps: ["clickedIdx", "eggs", "isMiniGameComplete", "bustedSrc", "busted", "showEggGame", "clickBeforeReady", "watchAdClicked", "show"], computedProps: ["chwBarProgress", "showAmountRewarded", "rewardItem", "txtState", "limitReached", "eggGameReady", "showCountDown", "showAdWatch", "showDescTxt", "showPopupBtn", "chickSrc", "rewardHasItem"], methodProps: ["placeBannerAdTag", "eggSrc", "eggSrcBusted", "eggBg", "eggClass", "checkIfReady", "eggClickCounter", "resetGame", "onGotWinner", "watchVideo", "signIn"], watchProps: ["busted"], methodParams: { "placeBannerAdTag": ["tagEl"], "eggSrc": ["count"], "eggBg": ["count"], "eggClass": ["count"], "checkIfReady": ["event"], "eggClickCounter": ["event"] }, watchParams: { "busted": ["val"] } },
        { name: "chicken-panel", methodProps: ["onChickenClick"] },
        { name: "chw", dataProps: ["chest"], computedProps: ["remainingMsg", "chwHomeTimerCls", "chwClass", "chwChickSrc", "chwShowTimer", "chwShowBtn", "playAdText", "btnStyle", "showChw"], methodProps: ["playIncentivizedAd"] },
        { name: "color-select", dataProps: ["freeColors", "paidColors"], computedProps: ["getExtraColorEggIcon"], methodProps: ["isSelectedClass", "onClick"], methodParams: { "isSelectedClass": ["idx"], "onClick": ["idx"] } },
        { name: "corner-buttons", computedProps: ["shareIcon", "settingsIcon", "isGameScreen"], methodProps: ["getLocValue"], methodParams: { "getLocValue": ["key"] } },
        { name: "create-private-game-popup", dataProps: ["showingRegionList", "mapIdx", "playClickedBeforeReady", "map", "mapLocKey", "mapImgPath", "mapNotFound", "mapSearchResults", "mapSearchResultsIdx", "mapSearchResultsMax", "mapSearchResultsMin", "mapSearchResultsShow", "mapSearchIsFocused", "mapKeyListners", "vueData"], computedProps: ["serverTxt", "mapSizeIcon"], methodProps: ["randomMap", "onRandomMapClick", "playSound", "onCloseClick", "onRegionChanged", "onMapChange", "selectMapForPickedGameType", "onKeyDownMapSelect", "handleKeydown", "removeKeydown", "onGameTypeChanged", "onPlayTypeWhenSignInComplete", "onPlaySentBeforeSignIn", "onPlayClick", "onGameTypeChange", "onMapChangeClick", "onServerChange", "onMapSerachKeyup", "onMapSearchReset", "onMapSearchResultClick", "onBlurSearhFocus"], watchProps: ["isGameReady"], methodParams: { "playSound": ["sound"], "onMapChange": ["dir"], "selectMapForPickedGameType": ["dir", "rnd"], "handleKeydown": ["event"], "onGameTypeChange": ["val"], "onMapChangeClick": ["idx"], "onServerChange": ["val"], "onMapSerachKeyup": ["event"], "onMapSearchResultClick": ["map"] }, watchParams: { "isGameReady": ["val"] } },
        { name: "dark-overlay", dataProps: ["show", "overlayClass"], computedProps: ["overlayStyle"] },
        { name: "display-ad", dataProps: ["isAdShowing", "refreshAllowed", "hideAds", "theAd", "houseAdData", "adBlocker", "finishedSetup"], computedProps: ["theClass"], methodProps: ["getTheAd", "setUpObserver", "onElObserved", "setAdVisible", "show", "hide", "crazyGamesAd", "triggerAd", "destroyAd", "toggleAd", "adblockerSetup", "hideAdBasedOnscreenSize", "adVisibility", "refreshAllow"], watchProps: ["isHidden", "checkProducts"], methodParams: { "onElObserved": ["ad"], "setAdVisible": ["visible"], "crazyGamesAd": ["id"], "toggleAd": ["val"] }, watchParams: { "isHidden": ["value"], "checkProducts": ["val"] } },
        { name: "egg-counter", computedProps: ["iconSrc", "formattedBalance"], methodProps: ["handleClick", "shake"] },
        { name: "egg-store", methodProps: ["onItemClicked", "openProductBundlePopup", "onTryPremItemOn"], methodParams: { "onItemClicked": ["sku"], "openProductBundlePopup": ["items"], "onTryPremItemOn": ["item"] } },
        { name: "egg-store-item", dataProps: ["purchased", "attempt", "productItems", "productIcon", "bundleInfo"], computedProps: ["headerGrid", "productTypeItem", "productTypeBundle", "productTypeCurrency", "productTypePass", "title", "imgCls", "priceCls", "description", "saleDesc", "style", "img", "itemType", "itemCls", "buyBtnText", "showItem", "flagTxt", "showSubtitle", "price", "subTitleCls", "buyNowBtnStyles", "premItemBtnText", "secondaryBtnStyle"], methodProps: ["onTryPremItemOn", "onItemClicked", "onPremSecondaryBtnClicked", "onVipClick", "getItemType", "setupProduct", "getIcon"] },
        { name: "equip-screen", computedProps: ["showShop", "isOnEquipModeSkins", "isOnEquipModeFeatured", "isEquipModeInventory", "isEquipModeShop", "isInShop", "isOnShopInventoryLimited", "isOnShopInventory", "getGridClass", "gridCls", "isEggStoreSaleItem", "isBuyingItemPrem", "showPurchasesUi", "showShopUi", "screenCls", "isSelectedInUnVaulted", "showPriceTag", "showShopCart", "photoBoothBtnTxt", "eggShopSortItems", "photoBoothBtnUi", "chwButtonTxt", "bundlePopupConfirmTxt"], methodProps: ["onItemSearchChange", "setupItemGridMain", "setup", "itemAvailForPurchase", "onPopupOpened", "onPopupClosed", "onHvsmPopupOpen", "onHvsmPopupClose", "updateEquippedItems", "clamp", "moveStampClick", "moveStamp", "resetStampPosition", "poseEquippedItems", "selectEquippedItemForType", "populateItemGridWithType", "populateItemGridWithTagged", "populateItemGrid", "onBackClick", "stampPositionKeyboardHandler", "addKeyboardStampPositionHandlers", "removeKeyboardStampPositionHandlers", "switchItemType", "itemSearch", "onItemSearch", "onItemSearchReset", "onTaggedItemsClicked", "onTaggedResetItems", "onPremiumItemsClicked", "showPremiumItems", "showTaggedItems", "showSelectedTagItems", "ownsTaggedItems", "selectFirstItemInShop", "switchTo", "showItemsAfterEquipModeSwitch", "onEquippedTypeSelected", "onChangedClass", "autoSelectItem", "selectItemClickSound", "onItemSelected", "isPremItemInStore", "selectItem", "getButtonToggleClass", "offerItemForSpecial", "hideItemForSpecial", "offerItemForSale", "hideItemForSale", "onBuyItemClicked", "onBuyItemConfirm", "onBuyItemClose", "boughtItemSuccess", "boughtItemFailed", "onRedeemClick", "onRedeemCodeConfirm", "redeemCodeSuccess", "redeemCodeFailed", "onPhysicalUnlockConfirm", "onColorChanged", "onSwitchToSkinsClicked", "getVaultedItemsForGrid", "onPhotoboothClick", "openProductBundlePopup", "onBundlePopupConfirm", "onBundlePopupClose", "equipTryPremItemOn", "equipAllItemsInbundle", "chwWatchAd", "renderStamp"], watchProps: ["itemSearchVal"], methodParams: { "setup": ["itemType", "wasFeatured"], "itemAvailForPurchase": ["i"], "clampValue": ["value", "min", "max"], "moveStampClick": ["x", "y"], "moveStamp": ["x", "y"], "populateItemGridWithType": ["itemType"], "populateItemGridWithTagged": ["tag", "itemType"], "populateItemGrid": ["items"], "stampPositionKeyboardHandler": ["event"], "switchItemType": ["itemType"], "onItemSearch": ["newVal", "oldVal"], "showTaggedItems": ["tag", "itemType"], "showSelectedTagItems": ["tag"], "ownsTaggedItems": ["tag"], "switchTo": ["mode", "useItemType"], "onEquippedTypeSelected": ["itemType"], "autoSelectItem": ["item"], "selectItemClickSound": ["selectedItem"], "onItemSelected": ["item"], "isPremItemInStore": ["item"], "selectItem": ["item"], "getButtonToggleClass": ["equipMode"], "offerItemForSpecial": ["item"], "offerItemForSale": ["item"], "redeemCodeSuccess": ["eggs", "items"], "onColorChanged": ["colorIdx"], "getVaultedItemsForGrid": ["selectFirstItem"], "openProductBundlePopup": ["bundle"], "equipTryPremItemOn": ["item"] }, watchParams: { "itemSearchVal": ["val", "old"] } },
        { name: "equipped-slots", dataProps: ["itemType"], computedProps: ["emptyHatClass", "emptyStampClass"], methodProps: ["onClick"], methodParams: { "onClick": ["itemType"] } },
        { name: "event-panel", dataProps: ["now", "day", "hours", "doubleEggSoonImgSrc", "doubleEggLiveImgSrc"], computedProps: ["doubleEggWeekendSoon", "doubleEggWeekend", "doubleEggEventUrl", "showEvent"], methodProps: ["isEventDate"], methodParams: { "isEventDate": ["days"] } },
        { name: "factions-popup", dataProps: ["btnStyles", "isOnCooldown", "cooldownCount", "costToSwitch"], computedProps: ["eggOrgLogo", "paraDescTxt"], methodProps: ["handleFactionClick", "handlePlayNowClick", "startCooldown", "getBtnText", "getBtnStyle", "getFactionActiveStyle", "getFactionImg"], watchProps: ["popupOpen", "cooldownTimer"], methodParams: { "handleFactionClick": ["factionId"], "getBtnText": ["factionId"], "getBtnStyle": ["factionId"], "getFactionActiveStyle": ["factionId"], "getFactionImg": ["factionId"] }, watchParams: { "popupOpen": ["val"], "cooldownTimer": ["val"] } },
        { name: "footer-links-panel", methodProps: ["onChangelogClicked", "playSound", "onHelpClick", "openInNewTab"], methodParams: { "openInNewTab": ["url"] } },
        { name: "game-options-popup", computedProps: ["inGame"], methodProps: ["onShareLinkCopy", "onDefaults", "onShow", "onApply", "onCancel", "onOkClicked", "onSettingAdjusted", "toggleWeaponClass", "checkboxChange", "init", "close", "resetGame"], methodParams: { "onSettingAdjusted": ["id", "value"], "toggleWeaponClass": ["classIdx"], "checkboxChange": ["event"] } },
        { name: "game-screen", computedProps: ["isRespawning", "vipPromoWindowOpen", "showVipAdPromo", "isTeamGame", "teamColorCss", "teamName", "newTeamColorCss", "newTeamName", "muteButtonLabel", "showIngameWidget", "showMusicWidget", "isEggStoreSaleItem", "upgradeBadgeUrl", "playerSocial", "chwShowVideoIcon", "progressMsg", "progressBarWrapClass", "playAdText", "chwShowCountdown", "chwChickSrc", "playBtnColor", "playBtnText", "playBtnAdBlockerText", "classGameType", "pauseScreenWrapGrid", "pauseScreenStateClass", "chatEnabled", "chwProgress", "isReportFilled", "serverLoc", "spectateControls", "canChangeTeams", "optionsButtonClass", "wakeTheChw"], methodProps: ["sharedPopupOpened", "sharedPopupClosed", "showGameMenu", "announcementMsg", "announcementMsgReset", "delayGameMenuPlayButtons", "hideGameMenu", "onLeaveGameConfirm", "onLeaveGameCancel", "leaveGame", "hidePopupsIfGameCloses", "afterLeftGame", "onHelpClicked", "onShareLinkClicked", "onSettingsClicked", "onShareLinkConfirm", "onEquipClicked", "onSwitchTeamClicked", "onSwitchTeamConfirm", "onControllerButton", "gaSendOnClassChange", "onPlayClicked", "jiggleRespawnButton", "onSpectateClicked", "showPlayerActionsPopup", "onMuteClicked", "onReportActionClicked", "onReportClicked", "onBootClicked", "onBanActionClicked", "onBanClicked", "onInfoClicked", "resizeBannerAdTagForGame", "earnInGameReward", "inGameRewardSuccessCallback", "inGameRewardIsGranted", "inGameRewardFailedCallback", "rewardReachedDailyLimits", "pokiTimers", "pauseWeaponSelect", "songHasChanged", "crazyAdsRespawn", "onClickCreator", "openVipPopup", "gaSend", "playIncentivizedAd", "onEggShopClicked", "onFullscreenClicked", "pauseUi", "resetUi", "resetMsgs", "clearMsgTimers", "onTutorialPopupClick", "onLockClicked", "challengeReroll", "killDeathMsg", "challengeMsg", "ctsCapturedMsg", "bestStreakUpdate", "ingameNotification", "attemptToShowNotification", "applyNotificationEffects", "clearNotificationEffects", "showWelcomeBundleCta", "onEmitShowWelcomeBundlePopup"], watchProps: ["isPokiGameLoad", "isPokiNewRewardTimer", "kname", "kdname", "announcementMessage", "vipPromoWindowOpen"], methodParams: { "sharedPopupOpened": ["id"], "sharedPopupClosed": ["id"], "onSettingsClicked": ["openMisc"], "onControllerButton": ["event"], "inGameRewardIsGranted": ["rewardValue"], "pokiTimers": ["value", "milliseconds"], "onClickCreator": ["url"], "gaSend": ["label"], "resetMsgs": ["saveStreak"], "challengeReroll": ["id"] }, watchParams: { "isPokiGameLoad": ["value"], "isPokiNewRewardTimer": ["value"], "kname": ["val"], "kdname": ["val"], "announcementMessage": ["val"], "vipPromoWindowOpen": ["open"] } },
        { name: "gdpr", dataProps: ["isShowing", "showingNotification", "showingConsent", "showingNoConsent"], methodProps: ["show", "close", "onAgreeClicked", "onDisagreeClicked"] },
        { name: "give-stuff-popup", dataProps: ["languageCode", "eggBalance", "vueData", "isAbTest"], computedProps: ["popupTitle", "confirmBtnTxt"], methodProps: ["onGiveStuffComplete", "onClickTwitchDropsMore", "onGiveStuffPopupClosed"] },
        { name: "gold-chicken-popup", methodProps: ["onCloseClick", "onChickenClick"] },
        { name: "help", dataProps: ["showTab1", "selectedType", "email", "feedback", "doValidation", "emailInvalid", "messageInvalid", "qaNum", "newLoc", "localizeThis"], computedProps: ["isAccountDeleteReq", "isNoAccountForDelete", "sendBtnText", "feedbackTitle"], methodProps: ["playSound", "validateEmail", "validateMessage", "toggleTabs", "onBackClick", "sendFeedbackApi", "onSendClick", "onAccountDelectionConfirmed", "helpLocSetup", "openFeedbackTabWith"], watchProps: ["loc"], methodParams: { "playSound": ["sound"], "sendFeedbackApi": ["selected"], "helpLocSetup": ["locContent"], "openFeedbackTabWith": ["type"] }, watchParams: { "loc": ["val"] } },
        { name: "help-questions", methodProps: ["playSound"], methodParams: { "playSound": ["sound"] } },
        { name: "home-screen", computedProps: ["isEggStoreSaleItem", "twitchDropsBtnImgSrs", "isTwitchLinked"], methodProps: ["onHvsmPopupOpen", "onHvsmPopupClose", "onHvsmClicked", "playSound", "onEquipClicked", "showSignIn", "onSignInClicked", "onSignOutClicked", "leaveGameConfirmed", "onResendEmailClicked", "onHideResendEmail", "onBigHouseAdClosed", "onPlayerNameChanged", "onEggPlayClick", "api_incentivizedVideoRewardRequest", "onTwitchDropsClick", "chwStopCycle", "onGameTypeChanged", "getHvsmItems", "challengeReroll"], methodParams: { "onHvsmClicked": ["item"], "playSound": ["sound"], "onPlayerNameChanged": ["newName"], "onGameTypeChanged": ["val"], "challengeReroll": ["id"] } },
        { name: "house-ad", dataProps: ["count", "isVisible", "portalImage", "portalAltText"], computedProps: ["src", "alt", "link", "title", "imgSrc", "altText", "getImgSrcAlt", "showVip", "imgCls", "isCrazyGames"], methodProps: ["adClicked", "adOnClick"], watchProps: ["upgradeName", "inGame"], watchParams: { "upgradeName": ["val"], "inGame": ["val"] } },
        { name: "house-ad-big", dataProps: ["removeOverlayClick"], computedProps: ["adImageUrl"], methodProps: ["onCloseClicked", "onClicked", "close", "outsideClickClose", "handleOutsideClick"], watchProps: ["useAd"], methodParams: { "handleOutsideClick": ["event"] }, watchParams: { "useAd": ["bigAd"] } },
        { name: "house-ad-small", computedProps: ["adImageUrl"], methodProps: ["onClicked"] },
        { name: "icon", computedProps: ["svgName"] },
        { name: "item", dataProps: ["itemOnly", "active", "itemLimited", "itemUnlock", "itemTags", "itemTagsString", "renderDone", "observer", "premTxt"], computedProps: ["dataItem", "isItemSellable", "showPrice", "isPhysicalMerch", "isPremium", "isVipItem", "isLimited", "isDrop", "isItemOwned", "hasBanner", "isPremiumEggPurchase", "itemType", "bannerTxt", "canvasCls", "itemClass", "itemPrice", "priceIcon", "equipCostTagCls", "tooltipTxt", "tooltip", "bannerIconImg", "itemName"], methodProps: ["setupObserver", "onIntersection", "prepareItem", "setUpTags", "isEquippedSlot", "tooltipOnMouseOver", "highlightSelected", "itemHightlightedOrder", "renderItem", "onClick", "onClickBuy", "countWords"], watchProps: ["item"], methodParams: { "onIntersection": ["entries"], "countWords": ["str"] }, watchParams: { "item": ["val"] } },
        { name: "item-grid", computedProps: ["categoryName", "hiddenPremItemCheck", "gridCls", "itemsSorted", "emptyGridMsg"], methodProps: ["onItemSelected", "isSelected", "onSwitchToSkinsClick", "isPremItemInStore"], methodParams: { "onItemSelected": ["selectedItem"], "isSelected": ["item"] } },
        { name: "item-type-selector", dataProps: ["showingTagged", "selected"], methodProps: ["onItemTypeClick", "getTabStyle", "getSelected"], methodParams: { "onItemTypeClick": ["itemType"], "getTabStyle": ["item"], "getSelected": ["item"] } },
        { name: "language-selector", dataProps: ["languageCode"], methodProps: ["playSound", "onChangeLanguage"], watchProps: ["selectedLanguageCode"], methodParams: { "playSound": ["sound"] }, watchParams: { "selectedLanguageCode": ["code"] } },
        { name: "large-popup", dataProps: ["isShowing", "overlays", "popupId", "removeOverlayClick"], computedProps: ["setOverlayCls"], methodProps: ["setVisible", "toggle", "show", "hide", "close", "onCloseClick", "onXClick", "cancelClick", "confirmClick", "addEventListeners", "escapeKeyClose", "handleOutsideClick", "cancelEventOverLayClickEscapeClose"], methodParams: { "setVisible": ["visible"], "escapeKeyClose": ["event"], "handleOutsideClick": ["event"] } },
        { name: "light-overlay", dataProps: ["show", "overlayClass"] },
        { name: "main-sidebar", dataProps: ["itemSelected", "logo"], computedProps: ["items"], methodProps: ["onLogoClick", "onBackClick", "previousScreen"], methodParams: { "onLogoClick": ["event"], "previousScreen": ["screen"] } },
        { name: "media-panel", dataProps: ["currentIdx", "maxIdx", "showNav"], computedProps: ["showItem", "showNews", "showTwitch", "showYoutube", "currentSpot", "maxSpot"], methodProps: ["nextItem", "backItem"] },
        { name: "media-tabs", dataProps: ["mediaTabs", "news", "twitch", "youTube", "delay", "rotateTimeout", "currentTab", "challenge", "chlg"], computedProps: ["tabName", "newsItems", "hasChlgs", "tabContentStyle", "newsContainerStyle"], methodProps: ["fetchJson", "selectTab", "cancelRotate", "rotateTab", "autoRotateTabs", "onTabClicked", "randomTabSelect", "timeFormat", "timer", "challengeReroll", "addChallengesTab", "removeChallengesTab"], watchProps: ["firebaseId", "challenges"], methodParams: { "selectTab": ["id", "playSound"], "onTabClicked": ["id"], "timeFormat": ["time"], "challengeReroll": ["id"] }, watchParams: { "firebaseId": ["val"], "challenges": ["val"] } },
        { name: "menu-item", dataProps: ["inGame"], computedProps: ["locKey", "iconCls", "listCls", "getIcon", "itemCls", "active"], methodProps: ["onMenuItemClick"], watchProps: ["currentScreen"] },
        { name: "music-widget", computedProps: ["theTitleAttr", "getTitleAlbum", "getSponsorImg", "getSponsorTitleAttr", "togglePlayStopIcon"], methodProps: ["loadVolume", "getAudioServer", "setIndex", "play", "playMusic", "pause", "playOnce", "playAudio", "openSettings", "volumeControl", "hideMe", "showMe", "gaSendEvent", "toggleMusic", "changeVolume"], watchProps: ["currIndex", "serverTracks", "musicSrc"], methodParams: { "setIndex": ["index"], "volumeControl": ["id", "value"], "gaSendEvent": ["action", "label"], "changeVolume": ["val"] }, watchParams: { "serverTracks": ["val"], "musicSrc": ["val"] } },
        { name: "news", computedProps: ["imageSrc"], methodProps: ["onItemThatIsClicked", "loadImage"] },
        { name: "notification-content", computedProps: ["rewardTitle", "currentNotification", "typeBg"], methodProps: ["resetState", "handleNextNotification", "onItemClosed", "onEggPackClosed", "onGiveStuffComplete", "onClickTwitchDropsMore", "getProductTitle", "openBundle", "onClosePopup", "eggPackClass", "eggName", "goToShop"], methodParams: { "getProductTitle": ["data"], "eggPackClass": ["eggs"], "eggName": ["eggs"] } },
        { name: "notification-slider", dataProps: ["notifyIdx", "text", "isType"], computedProps: ["endOfItems", "clsType", "title", "btnText", "showActionBtn", "ifItem", "ifChlg", "ifCurrency", "headerStyle", "filteredItems"], methodProps: ["nextItem", "closeItem", "modalBtn", "onActionBtnClick"] },
        { name: "photo-booth-ui", dataProps: ["eggSize", "bgIdx", "uiActive", "showBtn", "screenshotImg", "egg", "background"], computedProps: ["eggSizeTxt", "mapTxt", "uiTxt", "bgData"], methodProps: ["onChangeEggSize", "onChangeMap", "hideEggItem", "onShowOuterUi", "showOuterUi", "open", "close", "screenGrabStartProcess", "screenGrabDone", "gaSendStuff", "screenGrabStart", "screenGabDownload", "updateTypeVisibility"], methodParams: { "onChangeEggSize": ["size"], "onChangeMap": ["idx"], "hideEggItem": ["item", "idx", "hideAudio"], "showOuterUi": ["val"], "screenGrabDone": ["canvas"], "updateTypeVisibility": ["val"] } },
        { name: "physical-tag", methodProps: ["onBuyClick"] },
        { name: "play-panel", dataProps: ["pickedGameType", "isButtonDisabled", "playClickedBeforeReady", "playClickFunction", "kotcPrompt", "typeSelect", "isPromptOpen", "joinUrlRequest", "showCreateGameOnly"], computedProps: ["regionLocKey", "regionName", "selectedGameType", "gameTypeTxt", "serverText", "playBtn", "joinOnlyCls"], methodProps: ["onPickRegionButtonClick", "onRegionPicked", "onPickRegionPopupClosed", "onNameChange", "onPlayerNameKeyUp", "onGameTypeBtnOpen", "onGameTypeBtnClosed", "isWinSizeSmall", "onGameTypeChange", "onPlayTypeWhenSignInComplete", "onPlaySentBeforeSignIn", "hasValidPlayerNameCheck", "onPlayButtonClick", "onCloseCreateGame", "onJoinPrivateGameClickCrazyGames", "onJoinPrivateGameClick", "showJoinPrivateGamePopup", "onJoinConfirmed", "kotcAttachSetup", "anchorKotcPrompt", "onGameTypeClick", "onGameModePopupConfirm", "onJoinGameFocus", "onChangedClass"], watchProps: ["currentGameType", "isGameReady"], methodParams: { "onRegionPicked": ["regionId"], "onNameChange": ["event"], "onPlayerNameKeyUp": ["event"], "onGameTypeChange": ["event"], "onPlaySentBeforeSignIn": ["callback"], "showJoinPrivateGamePopup": ["showCode", "urlRequest"] }, watchParams: { "currentGameType": ["val"], "isGameReady": ["val"] } },
        { name: "player-challenge", dataProps: ["now", "diff", "end", "minutes", "seconds", "hours", "days", "gap", "timerDisplay", "reward", "reset", "goal", "period", "locRef", "type", "subType", "challengeData", "onClaimClicked", "onRerollClicked", "conditional", "value", "valueTwo"], computedProps: ["title", "desc", "imgSrc", "progress", "completed", "showActionBtn", "actionBtnStyle", "actionContentShow", "actionBtnContent", "trueProgress", "actionState", "timerData", "getGoal"], methodProps: ["onActionBtnClick", "timer", "timeFormat", "resizeTextToFit", "dynamicChallengeText"], methodParams: { "onActionBtnClick": ["event"], "timeFormat": ["time"], "resizeTextToFit": ["container", "maxFontSize"] } },
        { name: "player-challenge-list", dataProps: ["chlgsBeforeReroll", "chlgRerollID"], computedProps: ["hasChlgs", "wrapStyle"], methodProps: ["challengeReroll"], watchProps: ["challenges"], methodParams: { "challengeReroll": ["challengeId"] }, watchParams: { "challenges": ["val"] } },
        { name: "player-name", computedProps: ["cls"], methodProps: ["onNameChange", "onPlayerNameKeyUp"], methodParams: { "onNameChange": ["event"], "onPlayerNameKeyUp": ["event"] } },
        { name: "price-tag", computedProps: ["isPremium", "isNoPrice", "playerNeedsMoreEggs", "priceTagText", "priceTagTextCls", "watchAdsTxt", "isItemOwned", "showChwVideoIcon"], methodProps: ["onBuyClick", "onWatchAdsClick", "onGetMoreEggsClick"] },
        { name: "profile-screen", computedProps: ["isEggStoreSaleItem", "showTwitchEvent", "isTwitchLinked", "accountStatus", "accountBtnCls", "accountBtnTxt", "disableAccountBtn", "cgUserHasLinked"], methodProps: ["showSignIn", "onAccountBtnClicked", "onQuitAndLoginManage", "onTwitchDropsClick", "selectTab", "copyPlayerId"], methodParams: { "selectTab": ["val"] } },
        { name: "region-list-popup", dataProps: ["colorClasses"], computedProps: ["getLockText"], methodProps: ["playSound", "barColorClass", "barStyle", "onConfirmClick", "regionName"], methodParams: { "playSound": ["sound"], "barColorClass": ["region"], "barStyle": ["region"], "regionName": ["region"] } },
        { name: "settings", dataProps: ["showKeyboardTab", "showControllerTab", "showMiscTab", "originalSettings", "showDetailSettings", "originalLanguage", "originalMusicVolume", "musicStatChg", "currentRegion", "icons"], computedProps: ["getControllerId"], methodProps: ["onChangeRegion", "selectTab", "switchTab", "captureOriginalSettings", "applyOriginalSettings", "onGameControlCaptured", "onSpectateControlCaptured", "onGamepadGameControlCaptured", "onGamepadSpectateControlCaptured", "onControlCaptured", "onSettingToggled", "onSettingAdjusted", "onVolumeChange", "onPrivacyOptionsClicked", "onCancelClick", "onCloseClick", "quickSave", "onSaveClick", "sendChangesToGa", "gaMusicVol", "onResetClick", "cancelLanguageSelect", "resetOriginalLanguage", "setSettings", "hideSetting", "onHelpClickDelete", "showForCrazyGame"], watchProps: ["currentRegionId"], methodParams: { "selectTab": ["val"], "switchTab": ["tab"], "onGameControlCaptured": ["id", "value"], "onSpectateControlCaptured": ["id", "value"], "onGamepadGameControlCaptured": ["id", "value"], "onGamepadSpectateControlCaptured": ["id", "value"], "onControlCaptured": ["controls", "id", "value"], "onSettingToggled": ["id", "value"], "onSettingAdjusted": ["id", "value"], "sendChangesToGa": ["originalSettings", "currentSettings"], "setSettings": ["settings"], "hideSetting": ["id"], "showForCrazyGame": ["locRef"] }, watchParams: { "currentRegionId": ["val"] } },
        { name: "settings-adjuster", dataProps: ["currentValue"], methodProps: ["onChange", "getCurrentValue"], watchProps: ["controlValue"], methodParams: { "onChange": ["event"] }, watchParams: { "controlValue": ["newValue"] } },
        { name: "settings-control-binder", dataProps: ["currentValue", "isCapturing"], methodProps: ["playSound", "labelFor", "reset", "capture", "onMouseDown", "onKeyDown", "onKeyUp", "onWheel", "onFocusOut"], watchProps: ["controlValue"], methodParams: { "playSound": ["sound"], "labelFor": ["binding"], "capture": ["binding"], "onMouseDown": ["event"], "onKeyDown": ["event"], "onKeyUp": ["event"], "onWheel": ["event"], "onFocusOut": ["event"] }, watchParams: { "controlValue": ["newValue"] } },
        { name: "settings-gamepad-binder", dataProps: ["currentValue", "isCapturing"], methodProps: ["playSound", "reset", "capture", "onMouseDown", "onKeyDown", "onKeyUp", "onButtonDown", "onFocusOut", "setIcon"], watchProps: ["controlValue"], methodParams: { "playSound": ["sound"], "capture": ["value"], "onMouseDown": ["event"], "onKeyDown": ["event"], "onKeyUp": ["event"], "onButtonDown": ["event"], "onFocusOut": ["event"], "setIcon": ["value"] }, watchParams: { "controlValue": ["newValue"] } },
        { name: "settings-toggler", dataProps: ["currentValue"], methodProps: ["onChange"], watchProps: ["controlValue"], methodParams: { "onChange": ["event"] }, watchParams: { "controlValue": ["newValue"] } },
        { name: "shell-streak-msg", computedProps: ["htmlId", "htmlClass", "msgLoc", "showRestock", "elStyle"] },
        { name: "shell-tips", dataProps: ["tip", "tips", "tipKey", "goodBrowser", "browserTipShown", "shownTips", "timer", "interval", "countDown"], computedProps: ["stylesWrapper", "styleMsg"], methodProps: ["getTipKey", "getTip", "randomTip", "checkBrowser", "isNotChromeFallback"], watchProps: ["isShowing"], watchParams: { "isShowing": ["val"] } },
        { name: "slider-component", dataProps: ["currentValue"], methodProps: ["onChange", "getCurrentValue"], watchProps: ["controlValue"], methodParams: { "onChange": ["event"] }, watchParams: { "controlValue": ["newValue"] } },
        { name: "small-popup", dataProps: ["isShowing", "overlays", "popupId", "removeOverlayClick"], computedProps: ["setOverlayCls"], methodProps: ["setVisible", "toggle", "show", "hide", "close", "onCloseClick", "onXClick", "cancelClick", "confirmClick", "addEventListeners", "escapeKeyClose", "handleOutsideClick", "cancelEventOverLayClickEscapeClose"], methodParams: { "setVisible": ["visible"], "escapeKeyClose": ["event"], "handleOutsideClick": ["event"] } },
        { name: "social-panel", dataProps: ["newsLetterUrl"], computedProps: ["socialItems"] },
        { name: "social-promo", dataProps: ["isBubbleActive", "bubbleRepeat", "bubbleHover", "isActive", "isItemOwned", "inventoryCheck"], computedProps: ["itemRedeemed", "urlTitle", "imgAlt", "imgSrc", "socialDesc", "cls", "useIcon"], methodProps: ["playSound", "discordBubbleTimer", "onClickReward", "gaSend"], methodParams: { "playSound": ["label"], "gaSend": ["label"] } },
        { name: "spinner-overlay", dataProps: ["isShowing", "header", "footer", "adIsShowing", "isShowTips", "tipKey", "tips", "tip", "eggGuyImg", "goodBrowser", "browserTipShown"], methodProps: ["show", "showSpinnerLoadProgress", "hide", "hideDisplayAd", "showDisplayAd", "toggleDisplayAd", "getTipKey", "randomTip", "isNotChrome", "isNotChromeFallback"], watchProps: ["isShowing"], methodParams: { "show": ["headerLocKey", "footerLocKey", "showTips"], "showSpinnerLoadProgress": ["percent"] }, watchParams: { "isShowing": ["val", "old"] } },
        { name: "ss-button", dataProps: ["isPromptOpen", "btnId", "onClickVal", "caret"], computedProps: ["menuPosClass", "caretDirection", "cartOnOpen", "clsBtn", "dropdownList"], methodProps: ["onListItemClick", "onDropdownClick", "onOutsideClick", "listItemTxt"], watchProps: ["isPromptOpen"], methodParams: { "onListItemClick": ["val", "idx"], "onDropdownClick": ["event"], "onOutsideClick": ["event"], "listItemTxt": ["val"] }, watchParams: { "isPromptOpen": ["val"] } },
        { name: "ss-button-dropdown", dataProps: ["isPromptOpen", "btnId", "onClickVal", "caret"], computedProps: ["menuPosClass", "caretDirection", "cartOnOpen", "clsBtn", "dropdownList"], methodProps: ["onListItemClick", "onDropdownClick", "onOutsideClick", "listItemTxt"], watchProps: ["isPromptOpen"], methodParams: { "onListItemClick": ["val", "idx"], "onDropdownClick": ["event"], "onOutsideClick": ["event"], "listItemTxt": ["val"] }, watchParams: { "isPromptOpen": ["val"] } },
        { name: "stat-item", dataProps: ["lifetimeCls", "currentCls"], computedProps: ["statTitle", "statMonthly", "statLifetime", "statWrapper"], methodProps: ["statName", "kdr", "setupStat"], methodParams: { "statName": ["key"], "kdr": ["kills", "deaths"], "setupStat": ["stat"] } },
        { name: "stats-content", computedProps: ["renderReady"], methodProps: ["statName", "kdr"], methodParams: { "statName": ["key"], "kdr": ["kills", "deaths"] } },
        { name: "sub-item", dataProps: ["isCurrentSub", "hasSub", "hasUpgrade", "locName", "numberWords"], computedProps: ["nameLowerCaseHyphens", "vipStyle", "name", "img", "priceTag", "buyBtnText", "isActive", "flagText", "valueTxt"], methodProps: ["subClick"], watchProps: ["upgradeName", "isUpgraded"], watchParams: { "upgradeName": ["val"], "isUpgraded": ["val"] } },
        { name: "subscription-store", computedProps: ["hasPlan", "expireDate", "planName", "manageInfo", "membershipTxt", "subStyle", "eggsPerKill", "hasActivePass", "getSubs", "subsRenewalStateTxt"], methodProps: ["onManageClick", "openVipPopup"] },
        { name: "twitch", methodProps: ["playSound", "loadImage"], methodParams: { "playSound": ["sound"] } },
        { name: "vip-help", computedProps: ["subButtonTxt"], methodProps: ["onBackClick", "openVipStore"] },
        { name: "weapon-select-panel", dataProps: ["charClass"], computedProps: ["weapon", "selectedWeaponDisabled", "isDisabled", "showDesc", "gridCls", "containerCls"], methodProps: ["onWeaponSelect", "addSelectedCssClass"], methodParams: { "onWeaponSelect": ["classIdx"], "addSelectedCssClass": ["classIdx"] } },
        { name: "wobbly-egg", dataProps: ["loadEggyolk", "loadEggwhite", "loadEggcontainer"] },
        { name: "youtube", computedProps: ["imgSrc"], methodProps: ["onVideoClick", "loadImage"], watchProps: ["item"], watchParams: { "item": ["newVal", "oldVal"] } },
    ],
    manualComponents: [
        { name: "chicken-panel", renderContains: "img/speechtail.webp" },
        { name: "crazy-games-button", renderContains: "Crazy Games Profile Picture" },
        { name: "help-questions", renderContains: "How do I throw a grenade, melee or inspect a weapon?" },
        { name: "house-ad-small", renderContains: "news_banner roundme_md" },
        { name: "item-timer", renderContains: "equip_timerem" },
        { name: "notification-currency", renderContains: "vertical-align-middle width_1 egg-img" },
        { name: "physical-tag", renderContains: "img/pricetag_right.webp" },
        { name: "vue-progress-outer", renderContains: "loading-progress-bar" }
    ],
    variableRemaps: [
        // part of old CONSTANTS object
        { name: "ANALYTICS", regex: /= ([a-zA-Z0-9$_]{1,2})\.CATEGORY\) \{/ },
        { name: "EGG_SHAKE_DURATION", regex: /remove\("egg-shake"\);\s*\}\s*\}, ([a-zA-Z0-9$_]{1,2})\);/ },
        { name: "LOCAL_STORAGE_KEY", regex: /\.getItem\(([a-zA-Z0-9$_]{1,2})\);\s*if \([a-z] && typeof [a-z]\.balance/ },
        { name: "SCREENS", regex: /screens: \{\s*type: Object,\s*default: \(\) => ([a-zA-Z0-9$_]{1,2})/ },

        { name: "componentChecker", regex: /> ([a-zA-Z0-9$_]{1,2})\.isAvailable\(/, objectParameters: { isAvailable: ["key"] } },
        // walks `instance.$parent` up past any BaseTransition/KeepAlive wrapper, stopping at the
        // first "real" component parent - not a vue2 concept (Vue 3-only internal helper, so
        { name: "getRealParent", regex: /function ([a-zA-Z0-9$_]{1,2})\(([a-zA-Z0-9$_]{1,2})\) \{\s*let [a-zA-Z0-9$_]{1,2} = \2 && \2\.\$parent;/, params: ["instance"] },
        { name: "isTransitionOrKeepAlive", regex: /function ([a-zA-Z0-9$_]{1,2})\(([a-zA-Z0-9$_]{1,2})\) \{\s*const [a-zA-Z0-9$_]{1,2} = \2\.\$options && \2\.\$options\.name;/, params: ["instance"] },
        { name: "lazyLoadDirective", regex: /.directive\("lazyload", ([a-zA-Z0-9$_]{1,2})\)/, objectParameters: { mounted: ["elem"] } },
        { name: "localStorageUtil", regex: / = ([a-zA-Z0-9$_]{1,2})\.getItem\(/, objectParameters: { getItem: ["name"], setItem: ["name", "value"] } },
        { name: "renderMain", regex: /render: ([a-zA-Z0-9$_]{2}),\s*components: / },
        { name: "safeGlobal", regex: /= ([a-zA-Z0-9$_]{1,2})\.vueApp\?\.vueData/ },
        { name: "typeUtils", regex: /return ([a-zA-Z0-9$_]{1,2})\.toBoolean\(this\./, objectParameters: { toBoolean: ["value"], toString: ["value"], toNumber: ["value", "fallback"] } }
    ],
    topLevelFunctions: [
        // the root Vue app options factory - `buildVueOptions(e)` is called once with the
        // player's initial language code (stashed straight onto `currentLanguageCode`), and its
        // own `watch` block reacts to that same value (and to firebaseId) changing later on.
        { name: "buildVueOptions", params: ["langCode"], watchParams: { loc: ["val"], firebaseId: ["val"] } }
    ],
    windowGroups: [
        {
            name: "overlayMethods",
            methodParams: {
                showSpinner: ["headerLocKey", "footerLocKey", "showTips"],
                showSpinnerLoadProgress: ["percent"],
                setDarkOverlay: ["visible", "overlayClass"],
                setLightOverlay: ["visible", "overlayClass"]
            }
        },
        // crazyGamesMethods: every method in this group takes no params - nothing to remap
        {
            name: "abTestMethods",
            methodParams: {
                abTestshowEggReward: ["data"]
            }
        },
        {
            name: "equipMethods",
            methodParams: {
                openEquipSwitchTo: ["mode"],
                setShellColor: ["colorIdx"],
                showItemOnEquipScreen: ["item", "mode"],
                showItem: ["item"],
                autoSelectItem: ["item"],
                showTaggedItemsOnEquipScreen: ["tag"],
                useSpecialItemsTag: ["tag"]
            }
        },
        {
            name: "urlParamMethods",
            methodParams: {
                urlParamShowItem: ["itemId", "openBuy"],
                urlParamShowItemType: ["type"],
                urlParamShowClass: ["gClass"],
                equipSwitchTo: ["type", "val"]
            }
        },
        {
            name: "gameMethods",
            methodParams: {
                gameJoined: ["gameType", "team"],
                setTeam: ["team"],
                disableRespawnButton: ["val"],
                setInGame: ["val"],
                setPause: ["val"],
                setGameDataUi: ["map"],
                killDeathMsg: ["msg"],
                challengeMsg: ["msg"],
                ctsCapturedMsg: ["msg"],
                shellStreakMsg: ["msg"],
                bestStreakUpdate: ["streak"],
                shellIngameNotification: ["item"]
            }
        },
        {
            name: "adMethods",
            methodParams: {
                setVipAdPromoActive: ["isStarting"],
                displayAdEventObject: ["event"],
                toggleRespawnDisplayAd: ["val"],
                setDisplayAdVisibility: ["val"],
                hideTitleScreenAd: ["forceHide"],
                hideHomeScreenAds: ["forceHide"],
                hideHeaderAd: ["forceHide"],
                toggleTitleScreenAd: ["val"],
                disaplyAdEventObject: ["event"],
                stopClicksFAdBlocker: ["event"],
                playIncentivizedAd: ["unused"]
            }
        },
        {
            name: "chwMethods",
            methodParams: {
                chicknWinnerError: ["val"],
                chwOnClick: ["val"],
                chwMiniGameCompleted: ["val"],
                placeBannerAdTagForNugget: ["tagEl"],
                chwUiTimerUpdate: ["hours", "minutes", "seconds", "progress", "ready", "limitReached", "count", "resets"]
            }
        },
        // chwComputed: every getter in this group takes no params - nothing to remap
        {
            name: "navigationMethods",
            methodParams: {
                onPhotoBoothHideUi: ["show"]
            }
        },
        {
            name: "popupMethods",
            methodParams: {
                showGenericPopup: ["titleLocKey", "contentLocKey", "confirmLocKey", "reload"],
                showOpenUrlPopup: ["url", "titleLocKey", "content", "confirmLocKey", "cancelLocKey"],
                showPlayerActionsPopup: ["slot"],
                showShareLinkPopup: ["url", "gameCode"],
                showGiveStuffPopup: ["titleLoc", "eggs", "items", "type", "callback"],
                showJoinPrivateGamePopup: ["showCode", "urlRequest"],
                showCreateGamePopup: ["code"],
                showBannedPopup: ["expire"]
            }
        },
        {
            name: "storeMethods",
            methodParams: {
                eggFloatie: ["amount"],
                showPopupEggStoreSingle: ["sku"],
                vipEndedPopup: ["type"],
                setAccountUpgraded: ["upgraded", "endDate"],
                showPurchasesPopup: ["types", "callback"],
                showChallengesAutoClaimed: ["chlgs"],
                openDevXsollaPopup: ["sku", "sub"],
                onOpenBundle: ["itemsOpen"]
            }
        },
        {
            name: "accountMethods",
            methodParams: {
                setPlayerName: ["playerName"],
                setPrivacySettings: ["ofAge", "targetedAds"],
                firebasePasswordReauthPopup: ["email"]
            }
        },
        {
            name: "appMethods",
            methodParams: {
                changeLanguage: ["languageCode"],
                setLocData: ["languageCode", "newLocData"],
                showUnsupportedPlatformPopup: ["contentLocKey"],
                onPhotoboothBgColorChange: ["bgClass"],
                onPhotoBoothBgImageChange: ["url"],
                screenGrabDone: ["canvasData"],
                useHouseAdSmall: ["smallHouseAd"],
                useHouseAdBig: ["bigHouseAd"],
                setUiSettings: ["settings"],
                externPlayObject: ["playType", "gameType", "playerName", "mapIdx", "joinCode"],
                histPushState: ["obj", "title", "param"],
                disablePlayButton: ["val"],
                musicVolumeControl: ["value"],
                musicWidget: ["val"],
                getLocLang: ["val"],
                useTags: ["val"],
                onGameTypeChanged: ["val"],
                setUiGaugeMeterData: ["data"],
                setPreviousScreen: ["screen"],
                changelogSetup: ["log"],
                assetSetup: ["totalAssets"]
            }
        }
    ],
    accessorParams: {
        // `vueData.equip`'s backing store for the currently-shown item grid - the setter clears
        // any pending lazy-render timeouts before swapping the list itself in.
        "set showingItems": ["items"]
    },
    whitelistedPropKeys: [
        "align",
        "alt",
        "aria-hidden",
        "class",
        "data-html2canvas-ignore",
        "for",
        "height",
        "href",
        "id",
        "key",
        "loc",
        "ref",
        "rel",
        "src",
        "style",
        "target",
        "title",
        "width"
    ],
    knownAbsent: ["slider-component"]
};

export default mappings;
