// tests-automation/TestSuites/accounts/create-and-import.e2e.test.js
// Что тестируется:
// 1) Создать 1-й аккаунт → 2) Settings → Edit Configuration → проставить 44.198.8.24 (validator + read-only) → Save
// 3) Accounts (с баг-обходом роутом) → 4) импорт 2-го аккаунта по PRIVATE_KEY (с паролем)
// 5) оба кошелька видны, у импортированного баланс корректный/неотрицательный.
// 6) Перевод: Receive (1-й) → копия адреса → Send (2-й) → Confirm & Send → списание = amount + fee → History.

const { expect, $ } = require('@wdio/globals');

describe('ASI Wallet - Create (1st) → Settings → Import (2nd) → Validate Balance', () => {
  it('creates first account, updates Custom Network, imports second account and validates balance', async () => {
    // ------ ENV & test data ------
    const BASE = process.env.URL_TO_TEST || 'http://184.73.0.34:3000/';
    const baseUrl = BASE.endsWith('/') ? BASE.slice(0, -1) : BASE;
    const url = (path) => `${baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;

    const accountNameNew = `Test Wallet ${Date.now()}`;
    const password = 'TestPass123!';
    const importName = `Test Imported ${Date.now()}`;
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error('PRIVATE_KEY is not set in environment');

    const expectedImportedBalanceStr = process.env.EXPECTED_IMPORTED_BALANCE || '';
    const expectedImportedBalance = expectedImportedBalanceStr ? parseFloat(expectedImportedBalanceStr) : null;
    const BAL_TOLERANCE = 1e-8;

    // ------ Helpers ------
    const goto = async (hashPath) => { await browser.url(url(hashPath)); };

    const scrollIntoViewSafe = async (el) => {
      try { await el.scrollIntoView(); }
      catch { await browser.execute((elem) => elem?.scrollIntoView({ block: 'center', inline: 'nearest' }), el); }
    };

    const waitEnabledAndClick = async (selector) => {
      const el = await $(selector);
      await el.waitForExist({ timeout: 10000 });
      await scrollIntoViewSafe(el);
      await el.waitForClickable({ timeout: 10000 });
      await el.click();
      return el;
    };

    const findOne = async (locators, opts = { timeout: 10000 }) => {
      for (const sel of locators) {
        const el = await $(sel);
        if (await el.isExisting()) return el;
        try { await el.waitForExist({ timeout: 500 }); return el; } catch {}
      }
      const first = await $(locators[0]);
      await first.waitForExist(opts);
      return first;
    };

    // --- Фокусируем элемент и убеждаемся, что он activeElement
    const focusStrict = async (el) => {
      await el.waitForDisplayed({ timeout: 10000 });
      await scrollIntoViewSafe(el);
      await el.click();
      await browser.execute((elem) => elem && elem.focus && elem.focus(), el);
      await browser.waitUntil(async () => {
        return await browser.execute((elem) => document.activeElement === elem, el);
      }, { timeout: 2000, timeoutMsg: 'Failed to focus the input element' });
    };

    // --- Нативная установка значения (обход React/Vue контроля)
    const setNativeValue = async (el, value) => {
      await browser.execute((elem, val) => {
        if (!elem) return;
        const last = elem.value;
        try { elem.defaultValue = ''; } catch {}
        const tracker = elem._valueTracker;
        if (tracker) tracker.setValue(last);
        elem.value = val;
        elem.dispatchEvent(new Event('input', { bubbles: true }));
        elem.dispatchEvent(new Event('change', { bubbles: true }));
        elem.blur && elem.blur();
      }, el, String(value));
    };

    /**
     * Жёсткая замена значения:
     * 1) JS: value='' + defaultValue='' + input/change
     * 2) Фокус
     * 3) Ctrl+A + Backspace через browser.keys
     * 4) el.setValue(target)
     * 5) Верификация -> при провале: setNativeValue(target)
     */
    const forceReplaceInputValue = async (el, target) => {
      const targetStr = String(target);
      await browser.execute((elem) => {
        if (!elem) return;
        elem.value = '';
        try { elem.defaultValue = ''; } catch {}
        elem.dispatchEvent(new Event('input', { bubbles: true }));
        elem.dispatchEvent(new Event('change', { bubbles: true }));
      }, el);
      await focusStrict(el);
      await browser.keys(['Control', 'a']);
      await browser.keys('Backspace');
      await el.setValue(targetStr);
      await browser.execute((elem) => elem && elem.blur && elem.blur(), el);
      await browser.pause(80);
      let val = await el.getValue();
      if (val.includes('localhost') || !val.includes(targetStr) || val !== targetStr) {
        await focusStrict(el);
        await browser.keys(['Control', 'a']);
        await browser.keys('Backspace');
        await setNativeValue(el, targetStr);
        await browser.pause(80);
        val = await el.getValue();
        if (val.includes('localhost') || val !== targetStr) {
          throw new Error(`Failed to set input value. Got "${val}" instead of "${targetStr}"`);
        }
      }
    };

    const ensureEditable = async (elGetter, clickEditCb) => {
      for (let i = 0; i < 3; i++) {
        const el = await elGetter();
        const readOnlyAttr = await el.getAttribute('readonly');
        const enabled = await el.isEnabled();
        if (!readOnlyAttr && enabled) return el;
        if (clickEditCb) await clickEditCb();
        await browser.pause(250);
      }
      const el = await elGetter();
      const readOnlyAttr = await el.getAttribute('readonly');
      const enabled = await el.isEnabled();
      throw new Error(`Input is not editable (readonly=${!!readOnlyAttr} enabled=${enabled}) after Edit Configuration attempts`);
    };

    const getAccountBalanceText = async (accName) => {
      const balanceEl = await $(`//h3[normalize-space()="${accName}"]/following-sibling::div[contains(normalize-space(),"REV")]`);
      await balanceEl.waitForDisplayed({ timeout: 10000 });
      return balanceEl.getText();
    };

    const parseRev = (txt) => {
      const m = txt.match(/([0-9]*\.?[0-9]+)\s*REV/i);
      return m ? parseFloat(m[1]) : NaN;
    };

    // ===== NEW: Helper для разблокировки аккаунта через refresh =====
    const unlockAccountIfNeeded = async (accountPassword) => {
      console.log('[TEST] Checking if account is locked...');
      
      // Проверяем различные индикаторы заблокированного аккаунта
      const lockedIndicators = [
        '//div[contains(.,"Account is locked")]',
        '//div[contains(.,"Please provide password")]',
        '//div[contains(.,"unlock account")]',
        '//*[contains(text(),"Account is locked")]',
        '//*[contains(text(),"locked")]',
        // Добавляем селекторы для алертов и ошибок
        '//div[@role="alert" and contains(.,"locked")]',
        '//div[contains(@class,"error") and contains(.,"locked")]',
        '//div[contains(@class,"alert") and contains(.,"locked")]',
        '//span[contains(.,"Account is locked")]',
        '//p[contains(.,"Account is locked")]'
      ];

      let isLocked = false;
      let foundIndicator = null;
      for (const selector of lockedIndicators) {
        const element = await $(selector);
        if (await element.isExisting()) {
          foundIndicator = selector;
          console.log(`[TEST] Account locked indicator found: ${selector}`);
          isLocked = true;
          break;
        }
      }

      if (isLocked) {
        console.log('[TEST] Account is locked, refreshing page to unlock...');
        // Сохраняем текущий URL чтобы вернуться после разблокировки
        const currentUrl = await browser.getUrl();
        console.log(`[TEST] Current URL before refresh: ${currentUrl}`);
        
        // Обновляем страницу
        await browser.refresh();
        await browser.pause(2000);

        // После обновления ищем поле для ввода пароля
        const passwordInputSelectors = [
          '//input[@type="password"]',
          '//input[@type="password" and @placeholder="Enter password"]',
          '//input[@type="password" and @placeholder="Password"]',
          '//label[contains(.,"Password")]/following::input[@type="password"][1]'
        ];

        let passwordEntered = false;
        for (const passSelector of passwordInputSelectors) {
          const passInput = await $(passSelector);
          if (await passInput.isExisting()) {
            try {
              await passInput.waitForDisplayed({ timeout: 5000 });
              console.log('[TEST] Password field found after refresh, entering password...');
              await passInput.setValue(accountPassword);
              passwordEntered = true;
              
              // Ищем кнопку подтверждения/разблокировки
              const unlockButtonSelectors = [
                '//button[normalize-space()="Unlock"]',
                '//button[normalize-space()="Unlock Account"]',
                '//button[contains(.,"Unlock")]',
                '//button[contains(.,"Submit")]',
                '//button[contains(.,"Continue")]',
                '//button[@type="submit"]'
              ];

              let buttonClicked = false;
              for (const btnSelector of unlockButtonSelectors) {
                const unlockBtn = await $(btnSelector);
                if (await unlockBtn.isExisting() && await unlockBtn.isDisplayed()) {
                  console.log(`[TEST] Found unlock button: ${btnSelector}, clicking...`);
                  await unlockBtn.click();
                  buttonClicked = true;
                  await browser.pause(2000);
                  console.log('[TEST] Unlock button clicked, waiting for page to load...');
                  break;
                }
              }
              
              if (!buttonClicked) {
                // Если не нашли кнопку, попробуем нажать Enter
                console.log('[TEST] No unlock button found, trying Enter key...');
                await browser.keys('Enter');
                await browser.pause(2000);
              }
              
              console.log('[TEST] Account should be unlocked now');
              return true;
            } catch (error) {
              console.log(`[TEST] Error during unlock: ${error.message}`);
            }
            
            if (passwordEntered) break;
          }
        }
        
        if (!passwordEntered) {
          console.log('[TEST] WARNING: No password field found after refresh!');
        }
      } else {
        console.log('[TEST] No locked indicators found, checking for unlock dialogs...');
      }
      
      // Также проверяем классические диалоги разблокировки (на случай, если они появятся)
      const unlockDialogSelectors = [
        '//h2[contains(.,"Unlock Account")]',
        '//h3[contains(.,"Unlock Account")]'
      ];

      for (const selector of unlockDialogSelectors) {
        const element = await $(selector);
        if (await element.isExisting()) {
          console.log(`[TEST] Unlock dialog detected: ${selector}`);
          
          const passInput = await $('//input[@type="password"]');
          if (await passInput.isExisting() && await passInput.isDisplayed()) {
            console.log('[TEST] Entering password in unlock dialog...');
            await passInput.setValue(accountPassword);
            
            const unlockBtn = await $('//button[contains(.,"Unlock")]');
            if (await unlockBtn.isExisting() && await unlockBtn.isDisplayed()) {
              console.log('[TEST] Clicking unlock button in dialog...');
              await unlockBtn.click();
              await browser.pause(1000);
              console.log('[TEST] Account unlocked via dialog');
              return true;
            }
          }
        }
      }
      
      console.log('[TEST] Account unlock check completed');
      return false;
    };

    // ----- Locators: Settings / Custom Network -----
    const H3_VALIDATOR = `//h3[normalize-space()="Custom network - validator node"]`;
    const H3_READONLY  = `//h3[normalize-space()="Custom network - read-only node"]`;
    const IP_INPUT_UNDER = (h3Xpath) => `${h3Xpath}/following::label[normalize-space()="IP/Domain:"][1]/following::input[1]`;
    const SAVE_CONFIG_BTN = `//button[normalize-space()="Save Configuration"]`;
    const EDIT_CONFIG_BTNS = [
      `//button[normalize-space()="Edit Configuration"]`,
      `//main//button[contains(.,'Edit Configuration')]`,
      `//h2[contains(.,'Custom Network Configuration')]/following::button[contains(.,'Edit')][1]`
    ];

    const clickEditConfiguration = async () => {
      try {
        const btn = await findOne(EDIT_CONFIG_BTNS);
        if (await btn.isExisting()) {
          await scrollIntoViewSafe(btn);
          if (await btn.isClickable()) await btn.click();
        }
      } catch { /* уже в режиме редактирования */ }
    };

    // ----- Locators: Import Account -----
    const IMPORT_H2 = `//h2[normalize-space()="Import Account"]`;
    const IMPORT_NAME_INPUTS = [
      `${IMPORT_H2}/following::input[@placeholder="Enter account name"][1]`,
      `${IMPORT_H2}/ancestor::div[1]//input[@placeholder="Enter account name"]`,
      `(${IMPORT_H2}/following::div)[1]//input[@placeholder="Enter account name"]`
    ];
    const IMPORT_METHOD_SELECTS = [
      `${IMPORT_H2}/following::select[1]`,
      `${IMPORT_H2}/ancestor::div[1]//select`
    ];
    const IMPORT_PK_INPUTS = [
      `${IMPORT_H2}/following::input[@type="password" and @placeholder="Enter private key (64 hex characters)"][1]`,
      `${IMPORT_H2}/ancestor::div[1]//input[@type="password" and @placeholder="Enter private key (64 hex characters)"]`
    ];
    const IMPORT_BUTTONS = [
      `${IMPORT_H2}/following::button[normalize-space()="Import Account"][1]`,
      `${IMPORT_H2}/ancestor::div[1]//button[normalize-space()="Import Account"]`
    ];

    // ======================
    // 0) Create FIRST account
    // ======================
    await goto('/#/');
    const nameInput = await $('//input[@placeholder="Enter account name"]');
    await nameInput.waitForExist({ timeout: 10000 });
    await nameInput.setValue(accountNameNew);

    await waitEnabledAndClick('//button[normalize-space()="Create Account"]');

    // Password step (new account)
    const passHeaderNew = await $('//h2[normalize-space()="Set Password for New Account"]');
    await passHeaderNew.waitForDisplayed({ timeout: 10000 });

    const passInputNew = await $('//input[@type="password" and @placeholder="Enter password"]');
    const confirmInputNew = await $('//input[@type="password" and @placeholder="Confirm password"]');
    await passInputNew.setValue(password);
    await confirmInputNew.setValue(password);

    await waitEnabledAndClick('//button[normalize-space()="Continue"]');

    // Подтверждаем, что аккаунт активен в шапке
    const headerActiveName = await $(`//header//span[normalize-space()="${accountNameNew}"]`);
    await headerActiveName.waitForDisplayed({ timeout: 10000 });

    // ======================
    // 1) SETTINGS: Update Custom Network endpoints
    // ======================
    await goto('/#/settings');

    // Убедимся, что выбран Custom Network
    const netSelect = await $('//header//select');
    if (await netSelect.isExisting()) {
      await netSelect.selectByAttribute('value', 'custom');
    }

    // Нажать Edit Configuration (иначе inputs могут быть readonly)
    await clickEditConfiguration();

    // Сделать поля редактируемыми и прописать IP
    const ipValidatorGetter = async () => $(IP_INPUT_UNDER(H3_VALIDATOR));
    const ipReadonlyGetter  = async () => $(IP_INPUT_UNDER(H3_READONLY));

    const ipValidator = await ensureEditable(ipValidatorGetter, clickEditConfiguration);
    await scrollIntoViewSafe(await $(H3_VALIDATOR));
    await forceReplaceInputValue(ipValidator, '44.198.8.24');

    const ipReadonly = await ensureEditable(ipReadonlyGetter, clickEditConfiguration);
    await scrollIntoViewSafe(await $(H3_READONLY));
    await forceReplaceInputValue(ipReadonly, '44.198.8.24');

    // Сохранить
    await waitEnabledAndClick(SAVE_CONFIG_BTN);
    await browser.pause(300);

    // ======================
    // 2) Перейти в Accounts и убедиться, что 1-й кошелёк виден
    // ======================
    await goto('/#/accounts');
    // Обход известного бага: дёргаем роут
    await goto('/#/');
    await goto('/#/accounts');

    const accountsHeader1 = await $(`//h2[starts-with(normalize-space(),'Your Accounts')]`);
    await accountsHeader1.waitForDisplayed({ timeout: 10000 });
    expect(await accountsHeader1.getText()).toContain('Your Accounts');

    const createdCardTitle = await $(`//h3[normalize-space()="${accountNameNew}"]`);
    await createdCardTitle.waitForDisplayed({ timeout: 10000 });

    // ======================
    // 3) Import SECOND account
    // ======================
    const importHeader = await $(IMPORT_H2);
    await importHeader.waitForDisplayed({ timeout: 10000 });
    await scrollIntoViewSafe(importHeader);

    const importNameInput = await findOne(IMPORT_NAME_INPUTS);
    await forceReplaceInputValue(importNameInput, importName);

    const methodSelect = await findOne(IMPORT_METHOD_SELECTS);
    await scrollIntoViewSafe(methodSelect);
    await methodSelect.selectByAttribute('value', 'private');

    const privateKeyInput = await findOne(IMPORT_PK_INPUTS);
    await forceReplaceInputValue(privateKeyInput, privateKey);

    const importBtn = await findOne(IMPORT_BUTTONS);
    await importBtn.waitForEnabled({ timeout: 10000 });
    await scrollIntoViewSafe(importBtn);
    await importBtn.click();

    // Password step для импортированного
    const passHeaderImported = await $('//h2[normalize-space()="Set Password for Imported Account"]');
    await passHeaderImported.waitForDisplayed({ timeout: 10000 });

    const passInputImported = await $('//input[@type="password" and @placeholder="Enter password"]');
    const confirmInputImported = await $('//input[@type="password" and @placeholder="Confirm password"]');
    await passInputImported.setValue(password);
    await confirmInputImported.setValue(password);

    await waitEnabledAndClick('//button[normalize-space()="Continue"]');

    // ======================
    // 4) Validate both accounts & imported balance
    // ======================
    await goto('/#/');
    await goto('/#/accounts');

    const accountsHeader2 = await $(`//h2[starts-with(normalize-space(),'Your Accounts')]`);
    await accountsHeader2.waitForDisplayed({ timeout: 10000 });

    const importedCardTitle = await $(`//h3[normalize-space()="${importName}"]`);
    await importedCardTitle.waitForDisplayed({ timeout: 10000 });

    // Обновим балансы при необходимости
    const refreshBtn = await $(`//button[normalize-space()="Refresh Balances"]`);
    if (await refreshBtn.isExisting()) {
      await refreshBtn.click();
      await browser.pause(600);
    }

    const importedBalText = await getAccountBalanceText(importName);
    const importedBal = parseRev(importedBalText);
    console.log(`[TEST] Imported balance text: "${importedBalText}", parsed: ${importedBal}`);

    if (expectedImportedBalance !== null && !Number.isNaN(expectedImportedBalance)) {
      const withinTolerance = Math.abs(importedBal - expectedImportedBalance) <= BAL_TOLERANCE;
      if (!withinTolerance) {
        throw new Error(`Expected imported balance ≈ ${expectedImportedBalance}, got ${importedBal} (from "${importedBalText}")`);
      }
    } else {
      expect(importedBal).toBeGreaterThanOrEqual(0);
    }

    const newAccBalanceTxt = await getAccountBalanceText(accountNameNew);
    expect(newAccBalanceTxt).toContain('REV');

    // ======================
    // 5) Transfer: Receive → copy address (first account) → Send from imported
    // ======================

    // --- Header account switcher (robust, class-agnostic) ---
    const headerSwitcherBtn = async () =>
      $('//header//button[.//span[text()="▼"]]');

    const getHeaderDropdown = async () =>
      $('//header//button[.//span[text()="▼"]]/following-sibling::div[1]');

    const openHeaderDropdown = async () => {
      const toggle = await headerSwitcherBtn();
      await toggle.waitForDisplayed({ timeout: 10000 });
      await toggle.scrollIntoView();
      for (let i = 0; i < 2; i++) {
        await toggle.click();
        const dd = await getHeaderDropdown();
        if (await dd.isDisplayed()) return dd;
        await browser.pause(150);
      }
      await browser.execute(el => el.click(), await headerSwitcherBtn());
      const dd = await getHeaderDropdown();
      await dd.waitForDisplayed({ timeout: 5000 });
      return dd;
    };

    const selectHeaderAccountByName = async (name) => {
      await openHeaderDropdown();

      // основной локатор по точному имени
      let option = await $(`//header//button[.//span[text()="▼"]]/following-sibling::div//button[.//span[normalize-space()="${name}"]]`);

      // фоллбэк: если имя визуально обрезано
      if (!(await option.isExisting())) {
        const head = name.slice(0, Math.min(12, name.length));
        option = await $(`//header//button[.//span[text()="▼"]]/following-sibling::div//button[.//span[contains(normalize-space(),"${head}")]]`);
      }

      await option.waitForExist({ timeout: 10000 });
      await option.scrollIntoView();

      try {
        await option.waitForClickable({ timeout: 2000 });
        await option.click();
      } catch {
        await browser.execute(el => el.click(), option);
      }

      await browser.pause(250);
      
      // === NEW: Проверяем, не нужно ли разблокировать аккаунт после переключения ===
      await unlockAccountIfNeeded(password);
    };

    const getHeaderBalanceRev = async () => {
      const balEl = await $('//header//button//span[contains(.,"REV")]');
      await balEl.waitForDisplayed({ timeout: 10000 });
      const txt = await balEl.getText(); // напр. "777.0000 REV"
      const m = txt.match(/([0-9]*\.?[0-9]+)\s*REV/i);
      return m ? parseFloat(m[1]) : NaN;
    };

    // Переходим на страницу Receive под ПЕРВЫМ (созданным) аккаунтом
    await selectHeaderAccountByName(accountNameNew);
    await goto('/#/receive');

    // Забираем REV-адрес напрямую из DOM
    const revAddressEl = await $(`//div[normalize-space()="REV Address"]/following-sibling::div[1]`);
    await revAddressEl.waitForDisplayed({ timeout: 10000 });
    const recipientRevAddress = await revAddressEl.getText();
    expect(recipientRevAddress).toMatch(/^1[0-9A-Za-z]+$/); // простая sanity-проверка формата

    // Переключаемся на ИМПОРТИРОВАННЫЙ аккаунт и готовим отправку
    await selectHeaderAccountByName(importName);

    // Баланс до отправки
    const balanceBefore = await getHeaderBalanceRev();
    expect(Number.isFinite(balanceBefore)).toBe(true);

    // Параметры перевода
    const TRANSFER_AMOUNT = parseFloat(process.env.TRANSFER_AMOUNT || '1');
    const AMOUNT_TOLERANCE = 1e-8;

    // Открываем Send и заполняем форму
    await goto('/#/send');
    
    // === NEW: Проверяем сразу, не заблокирован ли аккаунт ===
    await browser.pause(500);
    const wasInitiallyLocked = await unlockAccountIfNeeded(password);
    if (wasInitiallyLocked) {
      console.log('[TEST] Account was locked on Send page, unlocked and continuing...');
      await browser.pause(1000);
    }
    
    const recipientInput = await $('//label[contains(.,"Recipient Address")]/following::input[@type="text"][1]');
    await recipientInput.waitForDisplayed({ timeout: 10000 });
    await recipientInput.setValue(recipientRevAddress);

    const amountInput = await $('//label[normalize-space()="Amount"]/following::input[@type="number"][1]');
    await amountInput.setValue(String(TRANSFER_AMOUNT));

    const sendTxBtn = await $('//button[normalize-space()="Send Transaction" and not(@disabled)]');
    await sendTxBtn.waitForClickable({ timeout: 10000 });
    await sendTxBtn.click();

    // === NEW: Проверяем, не появился ли запрос на разблокировку при отправке ===
    await browser.pause(500);
    const wasUnlocked = await unlockAccountIfNeeded(password);
    if (wasUnlocked) {
      // После разблокировки нужно заново заполнить форму, так как страница обновилась
      console.log('[TEST] Re-filling send form after unlock...');
      
      // Ждем загрузки страницы Send
      await browser.pause(1000);
      
      // Заново заполняем форму
      const recipientInputRetry = await $('//label[contains(.,"Recipient Address")]/following::input[@type="text"][1]');
      await recipientInputRetry.waitForDisplayed({ timeout: 10000 });
      await recipientInputRetry.setValue(recipientRevAddress);

      const amountInputRetry = await $('//label[normalize-space()="Amount"]/following::input[@type="number"][1]');
      await amountInputRetry.setValue(String(TRANSFER_AMOUNT));
      
      // Снова нажимаем Send Transaction
      const sendTxBtnRetry = await $('//button[normalize-space()="Send Transaction" and not(@disabled)]');
      await sendTxBtnRetry.waitForClickable({ timeout: 10000 });
      await sendTxBtnRetry.click();
    }

    // Модалка подтверждения
    const confirmModal = await $(`//div[contains(@class,"sc-bAehkN") or .//h3[normalize-space()="Confirm Transaction"]]`);
    await confirmModal.waitForDisplayed({ timeout: 10000 });

    const feeValueEl = await $(`//span[normalize-space()="Estimated Fee:"]/following-sibling::span[1]`);
    await feeValueEl.waitForDisplayed({ timeout: 10000 });
    const feeTxt = await feeValueEl.getText(); // напр. "0.001 REV"
    const feeMatch = feeTxt.match(/([0-9]*\.?[0-9]+)\s*REV/i);
    const estimatedFee = feeMatch ? parseFloat(feeMatch[1]) : NaN;
    expect(Number.isFinite(estimatedFee)).toBe(true);

    const confirmSendBtn = await $('//button[normalize-space()="Confirm & Send"]');
    await confirmSendBtn.waitForClickable({ timeout: 10000 });
    await confirmSendBtn.click();

    // === NEW: Проверяем, не появился ли еще один запрос на разблокировку при подтверждении ===
    await browser.pause(500);
    const wasUnlockedConfirm = await unlockAccountIfNeeded(password);
    if (wasUnlockedConfirm) {
      // После разблокировки страница обновилась, нужно заново пройти весь процесс отправки
      console.log('[TEST] Page refreshed during confirmation, retrying entire send process...');
      
      await browser.pause(1000);
      
      // Проверяем, не вернулись ли мы на страницу Send
      const recipientInputCheck = await $('//label[contains(.,"Recipient Address")]/following::input[@type="text"][1]');
      if (await recipientInputCheck.isExisting() && await recipientInputCheck.isDisplayed()) {
        // Да, мы снова на странице Send, заполняем заново
        await recipientInputCheck.setValue(recipientRevAddress);
        
        const amountInputRetry = await $('//label[normalize-space()="Amount"]/following::input[@type="number"][1]');
        await amountInputRetry.setValue(String(TRANSFER_AMOUNT));
        
        const sendTxBtnRetry = await $('//button[normalize-space()="Send Transaction" and not(@disabled)]');
        await sendTxBtnRetry.waitForClickable({ timeout: 10000 });
        await sendTxBtnRetry.click();
        
        // Ждем модалку подтверждения снова
        const confirmModalRetry = await $(`//div[contains(@class,"sc-bAehkN") or .//h3[normalize-space()="Confirm Transaction"]]`);
        await confirmModalRetry.waitForDisplayed({ timeout: 10000 });
        
        const confirmSendBtnRetry = await $('//button[normalize-space()="Confirm & Send"]');
        await confirmSendBtnRetry.waitForClickable({ timeout: 10000 });
        await confirmSendBtnRetry.click();
      } else {
        // Может быть мы все еще в модалке, пробуем нажать Confirm & Send снова
        const confirmSendBtnRetry = await $('//button[normalize-space()="Confirm & Send"]');
        if (await confirmSendBtnRetry.isExisting() && await confirmSendBtnRetry.isDisplayed()) {
          await confirmSendBtnRetry.click();
        }
      }
    }

    // Ждём уменьшение баланса
    await browser.waitUntil(async () => {
      const b = await getHeaderBalanceRev();
      return Number.isFinite(b) && b <= balanceBefore - TRANSFER_AMOUNT + AMOUNT_TOLERANCE;
    }, { timeout: 60000, interval: 1000, timeoutMsg: 'Header balance did not decrease after sending transaction' });

    const balanceAfter = await getHeaderBalanceRev();

    // Валидация: списание ≈ amount + fee
    const expectedDecrease = TRANSFER_AMOUNT + estimatedFee;
    const actualDecrease = balanceBefore - balanceAfter;
    const DEC_TOLERANCE = 1e-6;
    const within = Math.abs(actualDecrease - expectedDecrease) <= DEC_TOLERANCE;

    if (!within) {
      throw new Error(`Balance decrease mismatch. Before=${balanceBefore}, After=${balanceAfter}, ActualDecrease=${actualDecrease}, Expected≈${expectedDecrease} (amount=${TRANSFER_AMOUNT} + fee=${estimatedFee})`);
    }

    // ======================
    // 6) (Опционально) Проверка History
    // ======================
    await goto('/#/history');

    const refreshBtnHist = await $('//button[normalize-space()="🔄 Refresh"]');
    await browser.waitUntil(async () => {
      if (await refreshBtnHist.isDisplayed()) await refreshBtnHist.click();
      await browser.pause(1000);

      const noTxMsgExists = await $('//main//*[contains(text(),"No transactions found")]').isExisting();
      if (!noTxMsgExists) return true;

      const totalValEl = await $(`//div[normalize-space()="Total Transactions"]/preceding-sibling::div[1]`);
      if (await totalValEl.isExisting()) {
        const txt = await totalValEl.getText();
        const num = parseInt(txt, 10);
        if (!Number.isNaN(num) && num > 0) return true;
      }
      return false;
    }, { timeout: 60000, interval: 2000, timeoutMsg: 'Transaction did not appear in History in time' });

    console.log('[TEST] Test completed successfully!');
  });
});