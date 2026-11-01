FROM php:8.3-apache

RUN docker-php-ext-install pdo_mysql \
 && sed -ri 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
 && a2enmod headers \
 && printf 'ServerTokens Prod\nServerSignature Off\nTraceEnable Off\n' > /etc/apache2/conf-enabled/zz-hardening.conf \
 && printf 'expose_php = Off\ndisplay_errors = Off\nlog_errors = On\nsession.cookie_httponly = 1\nsession.use_strict_mode = 1\n' > /usr/local/etc/php/conf.d/zz-hardening.ini

COPY . /var/www/html/

# The backend container writes the snapshot into the shared /data volume.
RUN mkdir -p /data \
 && rm -f /var/www/html/printer_data.json \
 && ln -s /data/printer_data.json /var/www/html/printer_data.json \
 && rm -f /var/www/html/Dockerfile /var/www/html/.dockerignore

ENV DATA_FILE=/data/printer_data.json
