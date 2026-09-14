# ==============================================================================
# Ricoh Web Frontend & API - Dockerfile
# ==============================================================================
FROM php:8.2-apache

LABEL maintainer="Ricoh SNMP Monitor"
LABEL description="Webgrensesnitt og PHP REST API for Ricoh Kopimaskinovervåking"

# Installer nødvendige PHP-utvidelser
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzip-dev \
    zip \
    && docker-php-ext-install pdo_mysql opcache \
    && rm -rf /var/lib/apt/lists/*

# Aktiver Apache-moduler
RUN a2enmod rewrite headers

# Sett anbefalte PHP-innstillinger
RUN { \
    echo 'date.timezone = Europe/Oslo'; \
    echo 'upload_max_filesize = 10M'; \
    echo 'post_max_size = 12M'; \
    echo 'memory_limit = 128M'; \
} > /usr/local/etc/php/conf.d/ricoh.ini

# Kopier kildekoden
WORKDIR /var/www/html
COPY . /var/www/html/

# Gi Apache skrivetilgang til filer (slik at SFTP-bruker / webserver kan oppdatere printer_data.json)
RUN chown -R www-data:www-data /var/www/html \
    && chmod -R 755 /var/www/html

EXPOSE 80

CMD ["apache2-foreground"]
