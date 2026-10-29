# RAINY Workspace — Facebook Pro 5.2

Монгол интерфэйстэй Chrome өргөтгөл, танилцуулга болон татах хуудас.

## Веб хуудас

https://rainy-fb-workspace.fun-wasp-4344.chatgpt.site

## Шууд татах

[RAINY FB Pro 5.2 ZIP](downloads/rainy-fb-pro-5.2.zip)

ZIP-ийг бүрэн задлаад Chrome → `chrome://extensions` → Developer mode → Load unpacked → manifest.json байгаа хавтсыг сонгоно. Өргөтгөлөө Pin хийгээд RAINY дүрсийг дарна. Шинэчлэсний дараа Facebook tab-аа refresh хийнэ.

## Бүтэц

- `extension/`: хэрэглэгчид тараах Chrome өргөтгөл, үйлчилгээний хаяг урьдчилан тохируулсан.
- `index.html`, `style.css`, `app.js`: responsive танилцуулга, интерактив demo, 4 алхамт заавар, FAQ.
- `downloads/`: зөвхөн хэрэглэгчийн файлуудтай ZIP.
- `server/`: Wire.mn төлбөр, төхөөрөмжийн trial/лиценз, Telegram удирдлагын сервер.
- `owner/`: эзэмшигчийн build/signing хэрэгсэл. Private key-г хэрэглэгчид тараахгүй.

## Эрх

3 хоногийн trial. 30 хоног 49,900₮, 90 хоног 99,000₮, 365 хоног 299,000₮. Эрхийн дуусах он, сар, өдөр, цаг болон countdown байнга харагдана.

## Холболт

Төлбөрийн сервер Railway дээр байрласан. Wire API key зөвхөн серверийн environment variables-д байна. Хэрэглэгч серверийн хаяг/API key оруулахгүй. Төлбөр серверээр шалгагдаж, Telegram админ идэвхжүүлнэ. Webhook-гүй үед сервер хүлээгдсэн төлбөрийг 30 секунд тутам шалгана.

Тусламж: https://t.me/boroobro

Бодит Chromium UI/DOM болон автомат тестүүдээр шалгасан. Хэрэглэгчийн бодит Facebook account дээр пост илгээгээгүй. Facebook интерфэйс, эрх, checkpoint болон хязгаарлалтаас хамаарна; block болохгүй эсвэл бүх постыг 100% танина гэсэн баталгаа байхгүй.
