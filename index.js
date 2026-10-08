import { eventSource, event_types, characters, selectCharacterById, saveSettingsDebounced, getRequestHeaders } from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { power_user } from '../../../power-user.js';

const extensionName = 'third-party/CharacterPreview';
const extensionFolder = 'third-party/CharacterPreview';

// Store reference to currently open box and event handler
let currentBox = null;
let escapeKeyHandler = null;
let drawerWasOpen = false;

// Markdown library reference
let marked = null;

// Default tab configuration
const defaultTabConfig = {
    description:     { order: 0, visible: true, expanded: true },
    firstMessage:    { order: 1, visible: true, expanded: false },
    scenario:        { order: 2, visible: true, expanded: false },
    personality:     { order: 3, visible: true, expanded: false },
    creatorNotes:    { order: 4, visible: true, expanded: false },
    exampleMessages: { order: 5, visible: true, expanded: false },
};

// Extension settings with defaults
let extensionSettings = {
    boxWidth: 80,
    boxHeight: 80,
    boxPadding: 2,
    boxBorderRadius: 12,
    overlayOpacity: 70,
    primaryButtonColor: '#4a9eff',
    secondaryButtonColor: '#999999',
    contentWidth: 50,
    imageMaxHeight: 400,
    responsiveBreakpoint: 700,
    useThemePrimaryColor: true,
    useThemeSecondaryColor: true,
    fontColor: '#ffffff',
    backgroundColor: '#1a1a1a',
    backgroundOpacity: 95,
    blurStrength: 10,
    useThemeFontColor: true,
    useThemeBackgroundColor: true,
    useAccordionFirstMessage: false,
    tabConfig: JSON.parse(JSON.stringify(defaultTabConfig)),
};

/**
 * Log message with extension prefix
 * @param {string} message - Message to log
 */
function log(message) {
    console.log(`[Character Details Popup] ${message}`);
}

/**
 * Load the marked markdown library
 */
async function loadMarkedLibrary() {
    if (marked) {
        return marked;
    }

    try {
        // Dynamically load marked.js from CDN
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });

        // Access the global marked object
        marked = window.marked;

        // Configure marked for safe rendering
        marked.setOptions({
            breaks: true,
            gfm: true,
        });

        log('Marked library loaded successfully');
        return marked;
    } catch (error) {
        console.error('[Character Details Popup] Failed to load marked library:', error);
        return null;
    }
}

/**
 * Convert markdown to HTML safely
 * @param {string} text - The markdown text to convert
 * @returns {string} HTML string
 */
function renderMarkdown(text) {
    if (!text) return '';

    if (!marked) {
        return text;
    }

    try {
        return marked.parse(text);
    } catch (error) {
        console.error('[Character Details Popup] Markdown parsing error:', error);
        return text;
    }
}

/**
 * Build all first messages array from character data
 * @param {Object} data - Character data object
 * @returns {string[]} Array of all first messages
 */
function getAllFirstMessages(data) {
    const messages = [];
    const firstMes = data?.first_mes?.trim() || '';
    const alternates = data?.alternate_greetings || [];

    if (firstMes) {
        messages.push(firstMes);
    }

    for (const alt of alternates) {
        if (alt && alt.trim()) {
            messages.push(alt.trim());
        }
    }

    log(`Found ${messages.length} first message(s)`);
    return messages;
}

/**
 * Create first message section with swipe navigation
 * @param {string[]} messages - Array of first messages
 * @param {boolean} expanded - Whether section is open by default
 * @returns {HTMLElement} Details element with swipe navigation
 */
function createSwipeFirstMessageSection(messages, expanded) {
    const details = document.createElement('details');
    details.className = 'cdp-collapsible';
    details.open = expanded;

    const summary = document.createElement('summary');
    summary.className = 'cdp-collapsible__summary cdp-greeting-summary';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'cdp-greeting-title';

    if (messages.length > 1) {
        titleSpan.textContent = `첫 메시지 (1/${messages.length})`;

        const nav = document.createElement('div');
        nav.className = 'cdp-greeting-nav';

        const leftArrow = document.createElement('button');
        leftArrow.className = 'cdp-greeting-nav__arrow cdp-greeting-nav__arrow--disabled';
        leftArrow.innerHTML = '&#9664;';
        leftArrow.type = 'button';
        leftArrow.setAttribute('aria-label', '이전 첫 메시지');

        const rightArrow = document.createElement('button');
        rightArrow.className = 'cdp-greeting-nav__arrow';
        rightArrow.innerHTML = '&#9654;';
        rightArrow.type = 'button';
        rightArrow.setAttribute('aria-label', '다음 첫 메시지');

        nav.appendChild(leftArrow);
        nav.appendChild(rightArrow);
        summary.appendChild(titleSpan);
        summary.appendChild(nav);

        let currentIndex = 0;

        const content = document.createElement('div');
        content.className = 'cdp-collapsible__content cdp-markdown-content';
        content.innerHTML = renderMarkdown(messages[0]);

        const updateDisplay = () => {
            content.innerHTML = renderMarkdown(messages[currentIndex]);
            titleSpan.textContent = `첫 메시지 (${currentIndex + 1}/${messages.length})`;

            leftArrow.classList.toggle('cdp-greeting-nav__arrow--disabled', currentIndex === 0);
            rightArrow.classList.toggle('cdp-greeting-nav__arrow--disabled', currentIndex === messages.length - 1);
            log(`Showing first message ${currentIndex + 1}/${messages.length}`);
        };

        leftArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentIndex > 0) {
                currentIndex--;
                updateDisplay();
            }
        });

        rightArrow.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currentIndex < messages.length - 1) {
                currentIndex++;
                updateDisplay();
            }
        });

        details.appendChild(summary);
        details.appendChild(content);
    } else {
        titleSpan.textContent = '첫 메시지';
        summary.appendChild(titleSpan);

        const content = document.createElement('div');
        content.className = 'cdp-collapsible__content cdp-markdown-content';
        content.innerHTML = renderMarkdown(messages[0]);

        details.appendChild(summary);
        details.appendChild(content);
    }

    return details;
}

/**
 * Create first message section with accordion style
 * @param {string[]} messages - Array of first messages
 * @param {boolean} expanded - Whether first section is open by default
 * @returns {DocumentFragment} Fragment with multiple details elements
 */
function createAccordionFirstMessageSection(messages, expanded) {
    const fragment = document.createDocumentFragment();

    messages.forEach((message, index) => {
        const details = document.createElement('details');
        details.className = 'cdp-collapsible';
        if (index === 0 && expanded) {
            details.open = true;
        }

        const summary = document.createElement('summary');
        summary.className = 'cdp-collapsible__summary';

        if (messages.length > 1) {
            summary.textContent = `첫 메시지 (${index + 1}/${messages.length})`;
        } else {
            summary.textContent = '첫 메시지';
        }

        const content = document.createElement('div');
        content.className = 'cdp-collapsible__content cdp-markdown-content';
        content.innerHTML = renderMarkdown(message);

        details.appendChild(summary);
        details.appendChild(content);
        fragment.appendChild(details);
    });

    log(`Created accordion with ${messages.length} first message(s)`);
    return fragment;
}

/**
 * Create a generic collapsible section
 * @param {string} label - Section header text
 * @param {string} content - Section content
 * @param {boolean} expanded - Whether section is open by default
 * @param {boolean} useMarkdown - Whether to render content as markdown
 * @returns {HTMLElement} Details element
 */
function createCollapsibleSection(label, content, expanded, useMarkdown = false) {
    const details = document.createElement('details');
    details.className = 'cdp-collapsible';
    details.open = expanded;

    const summary = document.createElement('summary');
    summary.className = 'cdp-collapsible__summary';
    summary.textContent = label;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'cdp-collapsible__content' + (useMarkdown ? ' cdp-markdown-content' : '');

    if (useMarkdown) {
        contentDiv.innerHTML = renderMarkdown(content);
    } else {
        const textP = document.createElement('p');
        textP.textContent = content;
        contentDiv.appendChild(textP);
    }

    details.appendChild(summary);
    details.appendChild(contentDiv);

    return details;
}

/**
 * Create the first message section based on settings
 * @param {Object} data - Character data
 * @param {boolean} expanded - Whether section is open by default
 * @returns {HTMLElement|DocumentFragment|null} First message section or null if no messages
 */
function createFirstMessageSection(data, expanded = false) {
    const messages = getAllFirstMessages(data);

    if (messages.length === 0) {
        log('No first messages found');
        return null;
    }

    if (extensionSettings.useAccordionFirstMessage) {
        log('Using accordion display mode');
        return createAccordionFirstMessageSection(messages, expanded);
    } else {
        log('Using swipe display mode');
        return createSwipeFirstMessageSection(messages, expanded);
    }
}

/**
 * Fetch full character data from the server
 * @param {string} avatarUrl - The avatar filename/URL of the character
 * @returns {Promise<Object>} Full character data object
 */
async function fetchCharacterData(avatarUrl) {
    try {
        const response = await fetch('/api/characters/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl }),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.character || data;
    } catch (error) {
        console.error('[Character Details Popup] Failed to fetch character data:', error);
        throw error;
    }
}

/**
 * Close and cleanup the box
 */
function closeBox() {
    if (currentBox) {
        currentBox.remove();
        currentBox = null;
    }

    if (escapeKeyHandler) {
        document.removeEventListener('keydown', escapeKeyHandler);
        escapeKeyHandler = null;
    }

    if (drawerWasOpen) {
        const drawer = document.getElementById('right-nav-panel');
        if (drawer && drawer.classList.contains('closedDrawer')) {
            const drawerIcon = document.querySelector('#rightNavDrawerIcon');
            drawer.classList.remove('closedDrawer');
            drawer.classList.add('openDrawer');
            if (drawerIcon) {
                drawerIcon.classList.remove('closedIcon');
                drawerIcon.classList.add('openIcon');
            }
            log('Restored character panel state');
        }
        drawerWasOpen = false;
    }

    log('Box closed');
}

/**
 * Open the character box
 * @param {HTMLElement} boxElement - The box element to display
 * @param {number} characterId - The character ID for Start Chat functionality
 */
function openBox(boxElement, characterId) {
    closeBox();

    const drawer = document.getElementById('right-nav-panel');
    drawerWasOpen = drawer && drawer.classList.contains('openDrawer');

    updateButtonTextColors();
    currentBox = boxElement;
    document.body.appendChild(boxElement);

    const closeButton = boxElement.querySelector('#cdp-close');
    if (closeButton) {
        closeButton.addEventListener('click', function(event) {
            event.stopPropagation();
            closeBox();
        });
    }

    boxElement.addEventListener('click', function(event) {
        if (event.target === boxElement) {
            event.stopPropagation();
            closeBox();
        }
    });

    escapeKeyHandler = function(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closeBox();
        }
    };
    document.addEventListener('keydown', escapeKeyHandler);

    const startChatButton = boxElement.querySelector('#cdp-start-chat');
    if (startChatButton) {
        startChatButton.addEventListener('click', function(event) {
            event.stopPropagation();
            handleStartChat(characterId);
        });
    }

    log('Box opened');
}

/**
 * Handle Start Chat button click
 * @param {number} characterId - The character ID to load
 */
async function handleStartChat(characterId) {
    log(`Starting chat with character ID: ${characterId}`);

    closeBox();

    try {
        await selectCharacterById(String(characterId));
        log('Chat started');
    } catch (error) {
        console.error('[Character Details Popup] Unable to start chat:', error);
    }
}

/**
 * Create box HTML structure for character details
 * @param {Object} characterData - Character data object
 * @param {string} localAvatar - Local avatar filename (not the source URL)
 * @returns {HTMLElement} Box overlay element
 */
function createCharacterBox(characterData, localAvatar) {
    const data = characterData?.data || characterData;

    const name = data?.name ?? '이름 없는 캐릭터';
    const description = data?.description ?? '등록된 설명이 없습니다.';
    const creatorNotes = data?.creator_notes ?? '';
    const scenario = data?.scenario ?? '';
    const avatar = localAvatar ?? data?.avatar ?? '';
    const personality = data?.personality ?? '';
    const exampleMessages = data?.mes_example ?? '';

    const overlay = document.createElement('div');
    overlay.className = 'cdp-box__overlay';

    const box = document.createElement('div');
    box.className = 'cdp-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `${name} 미리보기`);
    box.setAttribute('aria-modal', 'true');

    const content = document.createElement('div');
    content.className = 'cdp-box__content';

    const header = document.createElement('div');
    header.className = 'cdp-box__header';

    if (avatar) {
        const img = document.createElement('img');
        img.className = 'cdp-box__image';
        img.src = `/characters/${encodeURIComponent(avatar)}`;
        img.alt = name;

        img.onerror = function() {
            this.src = 'img/ai4.png';
            log(`Failed to load avatar: ${avatar}, using default`);
        };

        header.appendChild(img);
    }

    const nameHeading = document.createElement('h2');
    nameHeading.className = 'cdp-box__name';
    nameHeading.textContent = name;
    header.appendChild(nameHeading);

    content.appendChild(header);

    const body = document.createElement('div');
    body.className = 'cdp-box__body';

    // Tab definitions with content getters and display settings
    const tabDefinitions = {
        description: {
            label: '설명',
            getContent: () => description,
            useMarkdown: true,
        },
        firstMessage: {
            label: '첫 메시지',
            isCustomBuilder: true,
            builder: (expanded) => createFirstMessageSection(data, expanded),
        },
        scenario: {
            label: '시나리오',
            getContent: () => scenario,
            useMarkdown: false,
        },
        personality: {
            label: '성격',
            getContent: () => personality,
            useMarkdown: false,
        },
        creatorNotes: {
            label: '제작자 노트',
            getContent: () => creatorNotes,
            useMarkdown: false,
        },
        exampleMessages: {
            label: '대화 예시',
            getContent: () => exampleMessages,
            useMarkdown: false,
        },
    };

    // Build tabs dynamically based on tabConfig
    const sortedTabs = Object.entries(extensionSettings.tabConfig)
        .filter(([, cfg]) => cfg.visible)
        .sort((a, b) => a[1].order - b[1].order);

    log(`Building ${sortedTabs.length} visible tabs`);

    for (const [tabId, cfg] of sortedTabs) {
        const def = tabDefinitions[tabId];
        if (!def) {
            log(`Unknown tab: ${tabId}`);
            continue;
        }

        if (def.isCustomBuilder) {
            const section = def.builder(cfg.expanded);
            if (section) {
                body.appendChild(section);
                log(`Added tab: ${tabId} (custom builder, expanded: ${cfg.expanded})`);
            }
        } else {
            const content = def.getContent();
            if (content && content.trim()) {
                const section = createCollapsibleSection(def.label, content.trim(), cfg.expanded, def.useMarkdown);
                body.appendChild(section);
                log(`Added tab: ${tabId} (expanded: ${cfg.expanded})`);
            }
        }
    }

    content.appendChild(body);
    box.appendChild(content);

    const footer = document.createElement('div');
    footer.className = 'cdp-box__footer';

    const startChatButton = document.createElement('button');
    startChatButton.id = 'cdp-start-chat';
    startChatButton.className = 'cdp-button cdp-button--primary';
    startChatButton.textContent = '대화 시작';

    const closeButton = document.createElement('button');
    closeButton.id = 'cdp-close';
    closeButton.className = 'cdp-button cdp-button--secondary';
    closeButton.textContent = '닫기';

    footer.appendChild(startChatButton);
    footer.appendChild(closeButton);
    box.appendChild(footer);

    overlay.appendChild(box);

    return overlay;
}

/**
 * Setup click interception for character cards
 */
function setupCharacterClickInterception() {
    const characterListContainer = document.getElementById('rm_print_characters_block');

    if (!characterListContainer) {
        console.error('[Character Details Popup] Character list container not found');
        return;
    }

    characterListContainer.addEventListener('click', async function(event) {
        const isBulkEditMode = characterListContainer.classList.contains('bulk_select');

        if (isBulkEditMode) {
            log('Bulk edit mode active');
            return;
        }

        const characterCard = event.target.closest('.character_select');

        if (characterCard) {
            const characterId = characterCard.getAttribute('data-chid');

            if (characterId) {
                if (event.shiftKey) {
                    log(`SHIFT+click - bypassing popup for character ${characterId}`);
                    return;
                }

                event.preventDefault();
                event.stopPropagation();

                log(`Character clicked - ID: ${characterId}`);

                const character = characters[Number(characterId)];

                if (!character) {
                    console.error(`[Character Details Popup] Character not found for ID: ${characterId}`);
                    return;
                }

                try {
                    log(`Fetching character data: ${character.avatar}`);
                    const fullCharacterData = await fetchCharacterData(character.avatar);

                    log(`Character data loaded: ${fullCharacterData.name || character.name}`);

                    const box = createCharacterBox(fullCharacterData, character.avatar);
                    openBox(box, Number(characterId));
                } catch (error) {
                    console.error('[Character Details Popup] Failed to load character:', error);
                    alert('캐릭터 정보를 불러오지 못했습니다. 다시 시도해 주세요.');
                }
            } else {
                log('Character card clicked but no data-chid found');
            }
        }
    }, true);

    log('Character click interception setup complete');
}

/**
 * Loads the extension settings from power_user
 */
function loadSettings() {
    if (power_user.extensions && power_user.extensions[extensionName]) {
        Object.assign(extensionSettings, power_user.extensions[extensionName]);

        // Ensure tabConfig exists and has all tabs with defaults
        if (!extensionSettings.tabConfig) {
            extensionSettings.tabConfig = JSON.parse(JSON.stringify(defaultTabConfig));
            log('Initialized default tabConfig for existing user');
        } else {
            // Merge any missing tabs from defaults
            for (const [tabId, defaults] of Object.entries(defaultTabConfig)) {
                if (!extensionSettings.tabConfig[tabId]) {
                    extensionSettings.tabConfig[tabId] = { ...defaults };
                    log(`Added missing tab config: ${tabId}`);
                }
            }
        }

        log('Settings loaded');
    }
}

/**
 * Saves the extension settings to power_user
 */
function saveSettings() {
    if (!power_user.extensions) {
        power_user.extensions = {};
    }
    power_user.extensions[extensionName] = extensionSettings;
    saveSettingsDebounced();
    log('Settings saved');
}

/**
 * Apply current settings to the box CSS
 */
function applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--cdp-box-width', `${extensionSettings.boxWidth}vw`);
    root.style.setProperty('--cdp-box-height', `${extensionSettings.boxHeight}vh`);
    root.style.setProperty('--cdp-box-padding', `${extensionSettings.boxPadding}rem`);
    root.style.setProperty('--cdp-box-border-radius', `${extensionSettings.boxBorderRadius}px`);
    root.style.setProperty('--cdp-overlay-opacity', `${extensionSettings.overlayOpacity / 100}`);

    const primaryColor = extensionSettings.useThemePrimaryColor
        ? 'var(--active, #4a9eff)'
        : extensionSettings.primaryButtonColor;
    const secondaryColor = extensionSettings.useThemeSecondaryColor
        ? 'color-mix(in srgb, var(--SmartThemeBodyColor, #333333) 12%, transparent)'
        : extensionSettings.secondaryButtonColor;
    const fontColor = extensionSettings.useThemeFontColor
        ? 'var(--SmartThemeBodyColor, #333333)'
        : extensionSettings.fontColor;
    const backgroundColor = extensionSettings.useThemeBackgroundColor
        ? 'var(--SmartThemeBlurTintColor, #fafafa)'
        : extensionSettings.backgroundColor;

    root.style.setProperty('--cdp-primary-button-color', primaryColor);
    root.style.setProperty('--cdp-secondary-button-color', secondaryColor);
    root.style.setProperty('--cdp-font-color', fontColor);
    root.style.setProperty('--cdp-background-color', backgroundColor);
    root.style.setProperty('--cdp-background-opacity', `${extensionSettings.backgroundOpacity / 100}`);
    root.style.setProperty('--cdp-blur-strength', `${extensionSettings.blurStrength}px`);
    root.style.setProperty('--cdp-content-width', `${extensionSettings.contentWidth}%`);
    root.style.setProperty('--cdp-image-max-height', `${extensionSettings.imageMaxHeight}px`);
    let layoutStyle = document.getElementById('cdp-responsive-style');
    if (!layoutStyle) {
        layoutStyle = document.createElement('style');
        layoutStyle.id = 'cdp-responsive-style';
        document.head.appendChild(layoutStyle);
    }
    const layoutRules = `@container cdp-preview (min-width: ${extensionSettings.responsiveBreakpoint}px) {
        .cdp-box__header { flex-direction: row; align-items: flex-start; }
        .cdp-box__image { flex-shrink: 0; max-width: 50%; }
        .cdp-box__name { text-align: left; margin-top: 0.5rem; }
    }`;
    if (layoutStyle.textContent !== layoutRules) layoutStyle.textContent = layoutRules;
    updateButtonTextColors();
}

/**
 * Reset settings to defaults
 */
function resetSettings() {
    extensionSettings = {
        boxWidth: 80,
        boxHeight: 80,
        boxPadding: 2,
        boxBorderRadius: 12,
        overlayOpacity: 70,
        primaryButtonColor: '#4a9eff',
        secondaryButtonColor: '#999999',
        contentWidth: 50,
        imageMaxHeight: 400,
        responsiveBreakpoint: 700,
        useThemePrimaryColor: true,
        useThemeSecondaryColor: true,
        fontColor: '#ffffff',
        backgroundColor: '#1a1a1a',
        backgroundOpacity: 95,
        blurStrength: 10,
        useThemeFontColor: true,
        useThemeBackgroundColor: true,
        useAccordionFirstMessage: false,
        tabConfig: JSON.parse(JSON.stringify(defaultTabConfig)),
    };
    saveSettings();
    applySettings();
    updateSettingsUI();
    log('Settings reset to defaults');
}

// Tab display labels
const tabLabels = {
    description: '설명',
    firstMessage: '첫 메시지',
    scenario: '시나리오',
    personality: '성격',
    creatorNotes: '제작자 노트',
    exampleMessages: '대화 예시',
};

/**
 * Swap tab order with adjacent tab
 * @param {string} tabId - Tab to move
 * @param {number} direction - -1 for up, 1 for down
 */
function swapTabOrder(tabId, direction) {
    const sorted = Object.entries(extensionSettings.tabConfig)
        .sort((a, b) => a[1].order - b[1].order);

    const currentIndex = sorted.findIndex(([id]) => id === tabId);
    const targetIndex = currentIndex + direction;

    if (targetIndex < 0 || targetIndex >= sorted.length) {
        return;
    }

    const currentTab = sorted[currentIndex][0];
    const targetTab = sorted[targetIndex][0];

    const tempOrder = extensionSettings.tabConfig[currentTab].order;
    extensionSettings.tabConfig[currentTab].order = extensionSettings.tabConfig[targetTab].order;
    extensionSettings.tabConfig[targetTab].order = tempOrder;

    saveSettings();
    renderTabConfigUI();
    log(`Moved tab '${tabId}' ${direction === -1 ? 'up' : 'down'}`);
}

/**
 * Render the tab configuration UI
 */
function renderTabConfigUI() {
    const container = $('#cdp-tab-config');
    if (!container.length) return;

    container.empty();

    const sorted = Object.entries(extensionSettings.tabConfig)
        .sort((a, b) => a[1].order - b[1].order);

    sorted.forEach(([tabId, cfg], index) => {
        const isFirst = index === 0;
        const isLast = index === sorted.length - 1;
        const label = tabLabels[tabId] || tabId;

        const row = $('<div>')
            .addClass('cdp-tab-row')
            .toggleClass('cdp-tab-row--hidden', !cfg.visible)
            .attr('data-tab-id', tabId);

        // Visibility toggle
        const visBtn = $('<button>')
            .addClass('cdp-tab-visibility')
            .attr('type', 'button')
            .attr('title', cfg.visible ? `${label} 숨기기` : `${label} 표시하기`)
            .attr('aria-label', cfg.visible ? `${label} 숨기기` : `${label} 표시하기`)
            .attr('aria-pressed', String(cfg.visible))
            .html(`<i class="fa-solid ${cfg.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>`)
            .on('click', function() {
                extensionSettings.tabConfig[tabId].visible = !extensionSettings.tabConfig[tabId].visible;
                saveSettings();
                renderTabConfigUI();
                log(`Tab '${tabId}' visible: ${extensionSettings.tabConfig[tabId].visible}`);
            });

        // Label
        const labelSpan = $('<span>').addClass('cdp-tab-label').text(label);

        // Expanded checkbox
        const expandedLabel = $('<label>').addClass('cdp-tab-expanded-label');
        const expandedCheck = $('<input>')
            .attr('type', 'checkbox')
            .attr('aria-label', `${label} 펼쳐 두기`)
            .prop('checked', cfg.expanded)
            .prop('disabled', !cfg.visible)
            .on('change', function() {
                extensionSettings.tabConfig[tabId].expanded = $(this).prop('checked');
                saveSettings();
                log(`Tab '${tabId}' expanded: ${extensionSettings.tabConfig[tabId].expanded}`);
            });
        expandedLabel.append(expandedCheck).append($('<span>').text('펼쳐 두기'));

        // Move buttons
        const upBtn = $('<button>')
            .addClass('cdp-tab-move')
            .attr('type', 'button')
            .attr('title', `${label} 위로 이동`)
            .attr('aria-label', `${label} 위로 이동`)
            .prop('disabled', isFirst)
            .text('↑')
            .on('click', () => swapTabOrder(tabId, -1));

        const downBtn = $('<button>')
            .addClass('cdp-tab-move')
            .attr('type', 'button')
            .attr('title', `${label} 아래로 이동`)
            .attr('aria-label', `${label} 아래로 이동`)
            .prop('disabled', isLast)
            .text('↓')
            .on('click', () => swapTabOrder(tabId, 1));

        row.append(visBtn, labelSpan, expandedLabel, upBtn, downBtn);
        container.append(row);
    });
}

const numericControls = [
    { id: 'cdp-box-width', key: 'boxWidth', min: 50, max: 95, step: 1 },
    { id: 'cdp-box-height', key: 'boxHeight', min: 50, max: 95, step: 1 },
    { id: 'cdp-box-padding', key: 'boxPadding', min: 1, max: 4, step: 0.1 },
    { id: 'cdp-box-border-radius', key: 'boxBorderRadius', min: 0, max: 30, step: 1 },
    { id: 'cdp-overlay-opacity', key: 'overlayOpacity', min: 0, max: 90, step: 1 },
    { id: 'cdp-background-opacity', key: 'backgroundOpacity', min: 0, max: 100, step: 1 },
    { id: 'cdp-blur-strength', key: 'blurStrength', min: 0, max: 30, step: 1 },
    { id: 'cdp-content-width', key: 'contentWidth', min: 30, max: 90, step: 1 },
    { id: 'cdp-image-max-height', key: 'imageMaxHeight', min: 200, max: 600, step: 10 },
    { id: 'cdp-responsive-breakpoint', key: 'responsiveBreakpoint', min: 400, max: 900, step: 10 },
];

const colorControls = [
    { id: 'cdp-font-color', key: 'fontColor', themeId: 'cdp-use-theme-font-color', themeKey: 'useThemeFontColor' },
    { id: 'cdp-background-color', key: 'backgroundColor', themeId: 'cdp-use-theme-background-color', themeKey: 'useThemeBackgroundColor' },
    { id: 'cdp-primary-button-color', key: 'primaryButtonColor', themeId: 'cdp-use-theme-primary-color', themeKey: 'useThemePrimaryColor' },
    { id: 'cdp-secondary-button-color', key: 'secondaryButtonColor', themeId: 'cdp-use-theme-secondary-color', themeKey: 'useThemeSecondaryColor' },
];

function normalizeNumber(value, control) {
    const number = Number(value);
    if (!Number.isFinite(number) || String(value).trim() === '') return null;
    const clamped = Math.min(control.max, Math.max(control.min, number));
    return Number((control.min + Math.round((clamped - control.min) / control.step) * control.step).toFixed(2));
}

function syncNumericControl(control) {
    document.getElementById(control.id).value = extensionSettings[control.key];
    document.getElementById(`${control.id}-number`).value = extensionSettings[control.key];
}

function syncColorControl(control) {
    const useTheme = extensionSettings[control.themeKey];
    const color = document.getElementById(control.id);
    const hex = document.getElementById(`${control.id}-hex`);
    document.getElementById(control.themeId).checked = useTheme;
    color.value = hex.value = extensionSettings[control.key];
    color.disabled = hex.disabled = useTheme;
    hex.setCustomValidity('');
    hex.removeAttribute('aria-invalid');
    document.getElementById(`${control.id}-mode`).textContent = useTheme ? '테마 연동 중' : '직접 지정';
}

function updateButtonTextColors() {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.appendChild(probe);
    for (const kind of ['primary', 'secondary']) {
        let textColor = 'var(--cdp-font-color)';
        if (kind === 'primary' || !extensionSettings.useThemeSecondaryColor) {
            probe.style.color = `var(--cdp-${kind}-button-color)`;
            const rgb = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
            if (rgb?.length === 3) {
                const linear = rgb.map(value => {
                    const channel = value / 255;
                    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
                textColor = luminance > 0.179 ? '#171717' : '#ffffff';
            }
        }
        document.documentElement.style.setProperty(`--cdp-${kind}-button-text`, textColor);
    }
    probe.remove();
}

function updateSettingsUI() {
    for (const control of numericControls) syncNumericControl(control);
    for (const control of colorControls) syncColorControl(control);
    $('#cdp-accordion-first-message').prop('checked', extensionSettings.useAccordionFirstMessage);
    renderTabConfigUI();
}

async function addExtensionSettings() {
    const settingsHtml = await renderExtensionTemplateAsync(extensionFolder, 'settings');
    $('#extensions_settings2').append(settingsHtml);

    for (const control of numericControls) {
        const slider = document.getElementById(control.id);
        const number = document.getElementById(`${control.id}-number`);
        const commit = (value) => {
            const normalized = normalizeNumber(value, control);
            if (normalized !== null && normalized !== extensionSettings[control.key]) {
                extensionSettings[control.key] = normalized;
                applySettings();
                saveSettings();
            }
            syncNumericControl(control);
        };
        slider.addEventListener('input', () => commit(slider.value));
        number.addEventListener('input', () => {
            if (number.value === '' || !number.validity.valid) return;
            const normalized = normalizeNumber(number.value, control);
            if (normalized === null || normalized === extensionSettings[control.key]) return;
            extensionSettings[control.key] = normalized;
            slider.value = normalized;
            applySettings();
            saveSettings();
        });
        number.addEventListener('change', () => commit(number.value));
        number.addEventListener('blur', () => commit(number.value));
        number.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); number.blur(); }
        });
    }

    for (const control of colorControls) {
        const color = document.getElementById(control.id);
        const hex = document.getElementById(`${control.id}-hex`);
        document.getElementById(control.themeId).addEventListener('change', event => {
            extensionSettings[control.themeKey] = event.target.checked;
            syncColorControl(control);
            applySettings();
            saveSettings();
        });
        const commitColor = (value) => {
            if (value.toLowerCase() === extensionSettings[control.key]) return;
            extensionSettings[control.key] = value.toLowerCase();
            syncColorControl(control);
            applySettings();
            saveSettings();
        };
        color.addEventListener('input', () => commitColor(color.value));
        hex.addEventListener('input', () => {
            const valid = /^#?[0-9a-f]{6}$/i.test(hex.value.trim());
            hex.setCustomValidity(valid ? '' : '#RRGGBB 형식으로 입력해 주세요. 예: #fff5f8');
            hex.setAttribute('aria-invalid', String(!valid));
            if (valid) {
                const value = hex.value.trim();
                commitColor(value.startsWith('#') ? value : `#${value}`);
            }
        });
        hex.addEventListener('change', () => {
            let value = hex.value.trim();
            if (!value.startsWith('#')) value = `#${value}`;
            if (/^#[0-9a-f]{6}$/i.test(value)) commitColor(value);
            else hex.reportValidity();
        });
        hex.addEventListener('keydown', event => {
            if (event.key === 'Enter') { event.preventDefault(); hex.blur(); }
            if (event.key === 'Escape') syncColorControl(control);
        });
    }

    $('#cdp-accordion-first-message').on('change', function() {
        extensionSettings.useAccordionFirstMessage = this.checked;
        saveSettings();
    });
    $('#cdp-reset-settings').on('click', resetSettings);
    updateSettingsUI();
}

/**
 * Initialize the extension
 */
async function init() {
    log('Initializing extension');

    await loadMarkedLibrary();

    eventSource.on(event_types.APP_READY, () => {
        log('Extension loaded');
        setupCharacterClickInterception();
    });
}

jQuery(async () => {
    loadSettings();
    applySettings();
    await addExtensionSettings();
    init();
});
