<?php
// Core Forms definitions with PHP-unserialized settings, as JSON.
$out = array();
foreach ( get_posts( array( 'post_type' => 'core-form', 'post_status' => 'any', 'numberposts' => -1 ) ) as $p ) {
	$messages = array();
	foreach ( get_post_meta( $p->ID ) as $key => $values ) {
		if ( strpos( $key, 'cf_message_' ) === 0 ) {
			$messages[ substr( $key, 11 ) ] = $values[0];
		}
	}
	$out[] = array(
		'id'       => $p->ID,
		'slug'     => $p->post_name,
		'title'    => $p->post_title,
		'status'   => $p->post_status,
		'markup'   => $p->post_content,
		'settings' => get_post_meta( $p->ID, '_cf_settings', true ),
		'messages' => $messages,
		'created'  => $p->post_date_gmt,
		'modified' => $p->post_modified_gmt,
	);
}
echo wp_json_encode( $out );
