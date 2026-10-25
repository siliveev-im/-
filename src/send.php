<?php
// Обработчик формы заявки. Работает на обычном хостинге с PHP.
// Адрес получателя подставляется из config.mjs (поле email) при сборке.
$to = '{{email}}';
$site = '{{domain}}';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') { header('Location: /'); exit; }
// Ловушка для ботов: настоящий посетитель это поле не видит
if (!empty($_POST['website'])) { header('Location: /spasibo/'); exit; }

function field($key, $max) {
  $v = isset($_POST[$key]) ? trim((string)$_POST[$key]) : '';
  $v = strip_tags($v);
  return mb_substr($v, 0, $max, 'UTF-8');
}

$name = field('name', 100);
$contact = field('contact', 100);
$topic = field('topic', 100);
$message = field('message', 1000);
$page = field('page', 50);
$consent = isset($_POST['consent']) && $_POST['consent'] === 'yes';

if ($to === '' || $name === '' || mb_strlen($contact, 'UTF-8') < 5 || !$consent) {
  header('Location: /kontakty/?error=1#zayavka');
  exit;
}

$subject = '=?UTF-8?B?' . base64_encode('Заявка с сайта: ' . $topic) . '?=';
$body = "Имя: $name\nКонтакт: $contact\nТема: $topic\nСтраница: $page\n\n$message\n\n"
      . "Согласие на обработку персональных данных: да, " . date('d.m.Y H:i') . "\n";
$host = parse_url($site, PHP_URL_HOST);
if (!$host) { $host = 'localhost'; }
$headers = "From: =?UTF-8?B?" . base64_encode('Заявка с сайта') . "?= <no-reply@$host>\r\n"
         . "Content-Type: text/plain; charset=utf-8\r\n"
         . "Content-Transfer-Encoding: 8bit\r\n";

$ok = mail($to, $subject, $body, $headers);
header('Location: ' . ($ok ? '/spasibo/' : '/kontakty/?error=1#zayavka'));
exit;
